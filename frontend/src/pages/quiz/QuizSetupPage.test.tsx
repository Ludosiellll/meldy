import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  createQuiz: vi.fn(),
  updateQuiz: vi.fn(),
  listQuizzes: vi.fn(),
  upload: vi.fn(),
  reload: vi.fn(),
  state: { summary: null as unknown, items: null as unknown },
}));

vi.mock('../../api/quizzes', () => ({ createQuiz: api.createQuiz, updateQuiz: api.updateQuiz, listQuizzes: api.listQuizzes }));
// The cover goes to storage through uploadPicture; its address is the public bucket's (here a made-up host).
vi.mock('../../api/itemPictures', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/itemPictures')>()),
  uploadPicture: api.upload,
  coverUrl: (path: string) => `https://covers.test/${path}`,
}));
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
/** The words a field points to with aria-describedby, its non-breaking spaces as spaces. */
const described = (field: HTMLElement) => plain(document.getElementById(field.getAttribute('aria-describedby') ?? '')?.textContent);
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
  api.upload.mockReset().mockResolvedValue('kept');
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
    expect(combo(QA_SETUP.who)).toHaveTextContent(QA_SETUP.whoOption('guests'));
    expect(screen.getByText(QA_SETUP.whoHint('guests'))).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: QA_SETUP.practice })).not.toBeChecked();
    expect(screen.getByRole('radio', { name: QA_SETUP.accentName('blue') })).toBeChecked();
    expect(screen.queryByRole('img', { name: QA_SETUP.coverAlt })).toBeNull();
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

describe('QuizSetupPage: who writes, the look, the offer to train (release 47, spec §47.1, §47.4, §47.5)', () => {
  it('«Кто может писать» has three choices, the hint says what the chosen one means, and the flags go with it', async () => {
    renderAt(`/exams/c/${EXAM}/quizzes/new`);
    fireEvent.click(combo(QA_SETUP.who));
    expect(screen.getAllByRole('option').map((node) => node.textContent)).toEqual([
      'все по ссылке, без входа',
      'все по ссылке, со входом',
      'только участники этого экзамена',
    ]);
    fireEvent.click(screen.getByRole('option', { name: QA_SETUP.whoOption('members') }));
    expect(screen.getByText(QA_SETUP.whoHint('members'))).toBeInTheDocument();
    expect(screen.queryByText(QA_SETUP.whoHint('guests'))).toBeNull();
    pick(QA_SETUP.who, QA_SETUP.whoOption('link'));
    expect(screen.getByText(QA_SETUP.whoHint('link'))).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: QA_SETUP.create }));
    await waitFor(() => expect(api.createQuiz).toHaveBeenCalledWith(EXAM, expect.objectContaining({ guests: false, members_only: false })));
  });

  it('only the exam’s members: members_only without guests', async () => {
    renderAt(`/exams/c/${EXAM}/quizzes/new`);
    pick(QA_SETUP.who, QA_SETUP.whoOption('members'));
    fireEvent.click(screen.getByRole('button', { name: QA_SETUP.create }));
    await waitFor(() => expect(api.createQuiz).toHaveBeenCalledWith(EXAM, expect.objectContaining({ guests: false, members_only: true })));
  });

  it('the guests’ hint is the one the spec gives', () => {
    expect(QA_SETUP.whoHint('guests')).toBe('Участнику не нужен аккаунт. Его попытки считаются по браузеру: в другом браузере можно начать заново.');
  });

  it('without an account and «балл, ошибки и верные ответы»: a hint under the review names the safer choice', async () => {
    const HINT =
      'Без входа тест можно открыть заново в другом браузере и увидеть ответы до своей попытки. ' +
      'Для контрольной лучше «балл и ошибки сразу; верные ответы и пояснения — после закрытия».';
    expect(QA_SETUP.reviewGuests).toBe(HINT);
    expect(QA_SETUP.reviewGuests).toContain(`«${QA_SETUP.reviewOption('mistakes_then_answers')}»`);
    renderAt(`/exams/c/${EXAM}/quizzes/new`);
    // The defaults (guests, answers after the closing): no hint.
    expect(screen.queryByText(HINT)).toBeNull();
    pick(QA_SETUP.review, QA_SETUP.reviewOption('answers'));
    const hint = screen.getByText(HINT);
    expect(hint).toHaveClass('im-hint');
    expect(hint.closest('.qa-field')?.textContent).toContain(QA_SETUP.review);
    // Signed in or members only: the attempts count by the account — no hint.
    pick(QA_SETUP.who, QA_SETUP.whoOption('link'));
    expect(screen.queryByText(HINT)).toBeNull();
    pick(QA_SETUP.who, QA_SETUP.whoOption('members'));
    expect(screen.queryByText(HINT)).toBeNull();
    pick(QA_SETUP.who, QA_SETUP.whoOption('guests'));
    expect(screen.getByText(HINT)).toBeInTheDocument();
    for (const review of ['score', 'mistakes', 'mistakes_then_answers'] as const) {
      pick(QA_SETUP.review, QA_SETUP.reviewOption(review));
      expect(screen.queryByText(HINT)).toBeNull();
    }
  });

  it('a cover is uploaded at once into the exam’s folder of quiz-covers, shown, and sent with the quiz', async () => {
    renderAt(`/exams/c/${EXAM}/quizzes/new`);
    const look = screen.getByRole('region', { name: QA_SETUP.partLook });
    expect(within(look).getByRole('button', { name: QA_SETUP.coverUpload })).toBeInTheDocument();
    const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])], 'cover.png', { type: 'image/png' });
    const input = look.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input.accept).toBe('image/png,image/jpeg,image/gif,image/webp');
    fireEvent.change(input, { target: { files: [file] } });
    const preview = await screen.findByRole('img', { name: QA_SETUP.coverAlt });
    expect(api.upload).toHaveBeenCalledTimes(1);
    const [path, picture, bucket] = api.upload.mock.calls[0] as [string, { type: string }, string];
    expect(path).toMatch(new RegExp(`^${EXAM}/[0-9a-f]{64}\\.png$`));
    expect(picture.type).toBe('image/png');
    expect(bucket).toBe('quiz-covers');
    expect(preview.getAttribute('src')).toBe(`https://covers.test/${path}`);
    expect(within(look).getByRole('button', { name: QA_SETUP.coverReplace })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: QA_SETUP.create }));
    await waitFor(() => expect(api.createQuiz).toHaveBeenCalledWith(EXAM, expect.objectContaining({ cover_path: path })));
  });

  it('«Убрать» takes the cover away', async () => {
    renderAt(`/exams/c/${EXAM}/quizzes/new`);
    const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 9, 9])], 'cover.png', { type: 'image/png' });
    fireEvent.change(document.querySelector('input[type="file"]') as HTMLInputElement, { target: { files: [file] } });
    await screen.findByRole('img', { name: QA_SETUP.coverAlt });
    fireEvent.click(screen.getByRole('button', { name: QA_SETUP.coverRemove }));
    expect(screen.queryByRole('img', { name: QA_SETUP.coverAlt })).toBeNull();
    expect(screen.getByRole('button', { name: QA_SETUP.coverUpload })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: QA_SETUP.create }));
    await waitFor(() => expect(api.createQuiz).toHaveBeenCalledWith(EXAM, expect.objectContaining({ cover_path: null })));
  });

  it('a cover storage refuses, or a file that is not a picture, is said in words and nothing is kept', async () => {
    api.upload.mockResolvedValue('refused');
    renderAt(`/exams/c/${EXAM}/quizzes/new`);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File([new Uint8Array([1, 2, 3])], 'big.png', { type: 'image/png' })] } });
    expect(await screen.findByRole('alert')).toHaveTextContent(QA_SETUP.coverRefused);
    expect(screen.queryByRole('img', { name: QA_SETUP.coverAlt })).toBeNull();
    fireEvent.change(input, { target: { files: [new File(['слова'], 'notes.txt', { type: 'text/plain' })] } });
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(QA_SETUP.coverType));
    expect(api.upload).toHaveBeenCalledTimes(1);
  });

  it('six colours with their names as one radio group; the chosen one goes with the quiz', async () => {
    renderAt(`/exams/c/${EXAM}/quizzes/new`);
    const group = screen.getByRole('group', { name: QA_SETUP.accent });
    const radios = within(group).getAllByRole('radio');
    expect(radios.map((radio) => radio.getAttribute('value'))).toEqual(['blue', 'green', 'orange', 'violet', 'pink', 'graphite']);
    expect(plain(group.textContent)).toContain('СинийЗелёныйОранжевыйФиолетовыйРозовыйГрафит');
    // One name for all six: the arrow keys move between them, Tab enters and leaves the group once.
    expect(new Set(radios.map((radio) => radio.getAttribute('name'))).size).toBe(1);
    fireEvent.click(within(group).getByRole('radio', { name: 'Зелёный' }));
    expect(within(group).getByRole('radio', { name: 'Зелёный' })).toBeChecked();
    expect(within(group).getByRole('radio', { name: 'Синий' })).not.toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: QA_SETUP.create }));
    await waitFor(() => expect(api.createQuiz).toHaveBeenCalledWith(EXAM, expect.objectContaining({ accent: 'green' })));
  });

  it('«После сдачи предложить тренироваться…» with its note', async () => {
    renderAt(`/exams/c/${EXAM}/quizzes/new`);
    const toggle = screen.getByRole('checkbox', { name: QA_SETUP.practice });
    expect(toggle).toHaveAccessibleDescription(
      'После закрытия ученикам предложат тренировать вопросы экзамена в Meldy (в тренировке видны все ответы). ' +
        'Кто согласится, появится в списке участников экзамена. Его прогресс вам не виден.',
    );
    // No «Участник станет участником»: the words say what happens and when.
    expect(document.body.textContent).not.toContain('станет участником');
    expect(screen.getByText(QA_SETUP.practiceNote)).toHaveClass('im-hint');
    fireEvent.click(toggle);
    expect(screen.getByText(QA_SETUP.practiceNote)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: QA_SETUP.create }));
    await waitFor(() => expect(api.createQuiz).toHaveBeenCalledWith(EXAM, expect.objectContaining({ offer_practice: true })));
  });

  it('after the start these settings still change, and only they are sent', async () => {
    const cover = `${EXAM}/${'a'.repeat(64)}.png`;
    api.listQuizzes.mockResolvedValue([listRow({ members_only: true, guests: false, cover_path: cover, accent: 'pink' })]);
    renderAt(`/exams/c/${EXAM}/quizzes/${QUIZ_ID}/edit`);
    expect(await screen.findByText(QA_SETUP.locked)).toBeInTheDocument();
    expect(combo(QA_SETUP.who)).toHaveTextContent(QA_SETUP.whoOption('members'));
    expect(screen.getByRole('img', { name: QA_SETUP.coverAlt }).getAttribute('src')).toBe(`https://covers.test/${cover}`);
    expect(screen.getByRole('radio', { name: 'Розовый' })).toBeChecked();
    expect(combo(QA_SETUP.who)).toBeEnabled();
    expect(screen.getByRole('checkbox', { name: QA_SETUP.practice })).toBeEnabled();
    pick(QA_SETUP.who, QA_SETUP.whoOption('guests'));
    fireEvent.click(screen.getByRole('button', { name: QA_SETUP.coverRemove }));
    fireEvent.click(screen.getByRole('radio', { name: 'Графит' }));
    fireEvent.click(screen.getByRole('checkbox', { name: QA_SETUP.practice }));
    fireEvent.click(screen.getByRole('button', { name: QA_SETUP.save }));
    await waitFor(() =>
      expect(api.updateQuiz).toHaveBeenCalledWith(QUIZ_ID, { members_only: false, guests: true, cover_path: null, accent: 'graphite', offer_practice: true }),
    );
  });
});

describe('QuizSetupPage: all the questions (?all=1, the constructor’s «Отправить по ссылке»)', () => {
  const more = () => screen.getByRole('button', { name: /^Ещё настройки/ });

  it('every subject with keyed questions, their whole pool, one set for everyone, in the exam’s order', async () => {
    renderAt(`/exams/c/${EXAM}/quizzes/new?all=1`);
    fireEvent.click(more());
    const subjects = screen.getByRole('group', { name: QA_SETUP.subjects });
    expect(within(subjects).getByRole('checkbox', { name: /Вариант 1/ })).toBeChecked();
    expect(within(subjects).getByRole('checkbox', { name: /Вариант 2/ })).toBeChecked();
    expect(combo(QA_SETUP.count)).toHaveTextContent('все (30)');
    expect(combo(QA_SETUP.set)).toHaveTextContent(QA_SETUP.setSame);
    expect(combo(QA_SETUP.order)).toHaveTextContent(QA_SETUP.orderFile);
    expect(combo(QA_SETUP.time)).toHaveTextContent('30 мин');
    // «все» stays «все» when a subject goes; the timer follows.
    fireEvent.click(within(subjects).getByRole('checkbox', { name: /Вариант 2/ }));
    expect(combo(QA_SETUP.count)).toHaveTextContent('все (15)');
    expect(combo(QA_SETUP.time)).toHaveTextContent('15 мин');
    fireEvent.click(within(subjects).getByRole('checkbox', { name: /Вариант 2/ }));
    fireEvent.click(screen.getByRole('button', { name: QA_SETUP.create }));
    await waitFor(() =>
      expect(api.createQuiz).toHaveBeenCalledWith(
        EXAM,
        expect.objectContaining({ subject_ids: [S1, S2], item_count: 30, same_set: true, shuffle_items: false, time_limit_min: 30 }),
      ),
    );
  });

  it('named as the test; five settings in view, the rest under «Ещё настройки», folded', () => {
    renderAt(`/exams/c/${EXAM}/quizzes/new?all=1`);
    expect(screen.getByLabelText(QA_SETUP.name)).toHaveValue('Зимняя сессия');
    const main = screen.getByRole('region', { name: QA_SETUP.partMain });
    expect(within(main).getByLabelText(QA_SETUP.name)).toBeInTheDocument();
    expect(within(main).getByRole('combobox', { name: QA_SETUP.time })).toBeInTheDocument();
    expect(within(main).getByRole('combobox', { name: QA_SETUP.closes })).toBeInTheDocument();
    expect(within(main).getByRole('combobox', { name: QA_SETUP.who })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: QA_SETUP.partLook })).toBeInTheDocument();
    const button = more();
    expect(button).toHaveAttribute('aria-expanded', 'false');
    const folded = document.getElementById(button.getAttribute('aria-controls') ?? '')!;
    expect(folded).not.toBeVisible();
    for (const name of [QA_SETUP.count, QA_SETUP.set, QA_SETUP.order, QA_SETUP.options, QA_SETUP.opens, QA_SETUP.attempts, QA_SETUP.pass, QA_SETUP.review]) {
      expect(screen.queryByRole('combobox', { name })).toBeNull();
    }
    expect(screen.queryByRole('group', { name: QA_SETUP.subjects })).toBeNull();
    expect(screen.queryByRole('checkbox', { name: QA_SETUP.practice })).toBeNull();
    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(folded).toBeVisible();
    for (const name of [QA_SETUP.count, QA_SETUP.set, QA_SETUP.order, QA_SETUP.options, QA_SETUP.opens, QA_SETUP.attempts, QA_SETUP.pass, QA_SETUP.review]) {
      expect(within(folded).getByRole('combobox', { name })).toBeInTheDocument();
    }
    expect(within(folded).getByRole('group', { name: QA_SETUP.subjects })).toBeInTheDocument();
    expect(within(folded).getByRole('checkbox', { name: QA_SETUP.practice })).toBeInTheDocument();
    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(folded).not.toBeVisible();
  });

  it('a name longer than a quiz may have is cut to 120 characters; an empty one keeps the usual', () => {
    api.state.summary = examSummary({ title: 'Б'.repeat(130) });
    renderAt(`/exams/c/${EXAM}/quizzes/new?all=1`);
    expect(screen.getByLabelText(QA_SETUP.name)).toHaveValue('Б'.repeat(120));
  });

  it('without it a new quiz keeps the usual start', () => {
    renderAt(`/exams/c/${EXAM}/quizzes/new?all=0`);
    expect(screen.getByLabelText(QA_SETUP.name)).toHaveValue('Контрольная · 16.10');
    expect(screen.queryByRole('button', { name: /^Ещё настройки/ })).toBeNull();
    expect(combo(QA_SETUP.count)).toHaveTextContent('20');
    expect(combo(QA_SETUP.set)).toHaveTextContent(QA_SETUP.setOwn);
    expect(combo(QA_SETUP.order)).toHaveTextContent(QA_SETUP.orderShuffle);
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

describe('QuizSetupPage: one subject, the date in words, the explanations (release 47 design fixes)', () => {
  it('an exam of one subject has no «Вопросы из»: the count’s hint says the pool', () => {
    api.state.summary = examSummary({ subjects: [examSummary().subjects[0]] });
    renderAt(`/exams/c/${EXAM}/quizzes/new`);
    expect(screen.queryByRole('group', { name: QA_SETUP.subjects })).toBeNull();
    expect(screen.queryByRole('checkbox', { name: /Вариант 1/ })).toBeNull();
    const count = combo(QA_SETUP.count).closest('.qa-field')!;
    expect(plain(count.textContent)).toContain('В контрольную идут только вопросы с ключом: их 15.');
  });

  it('two subjects (the oral one does not count): «Вопросы из» stays', () => {
    renderAt(`/exams/c/${EXAM}/quizzes/new`);
    expect(screen.getByRole('group', { name: QA_SETUP.subjects })).toBeInTheDocument();
  });

  it('beside the date field, the date in words; it follows the field', () => {
    renderAt(`/exams/c/${EXAM}/quizzes/new`);
    const field = screen.getByLabelText(QA_SETUP.closesField);
    // A week on from 16 October, 23:59 of the device.
    expect(described(field)).toBe('до 23 октября, 23:59');
    fireEvent.change(field, { target: { value: '2026-10-25T23:59' } });
    expect(described(field)).toBe('до 25 октября, 23:59');
    pick(QA_SETUP.opens, QA_SETUP.opensAt);
    fireEvent.change(screen.getByLabelText(QA_SETUP.opensField), { target: { value: '2027-01-03T09:00' } });
    // Another year says its year.
    expect(described(screen.getByLabelText(QA_SETUP.opensField))).toBe('с 3 января 2027, 09:00');
    pick(QA_SETUP.closes, QA_SETUP.closesNever);
    expect(screen.queryByText(/^до /)).toBeNull();
  });

  it('the review’s option for the safe default fits its words; no explanations in the set — no line', () => {
    expect(QA_SETUP.reviewOption('mistakes_then_answers')).toBe('балл и ошибки сразу; верные ответы и пояснения — после закрытия');
    renderAt(`/exams/c/${EXAM}/quizzes/new`);
    expect(combo(QA_SETUP.review)).toHaveTextContent(QA_SETUP.reviewOption('mistakes_then_answers'));
    expect(screen.queryByText(/В тесте есть пояснения/)).toBeNull();
  });

  it('a question of the set with an explanation: a line under the review says when the takers see it', () => {
    const items = examItems();
    items.set('i37', { ...items.get('i37')!, explanation: 'Два знака равенства сравнивают значения.' });
    api.state.items = items;
    renderAt(`/exams/c/${EXAM}/quizzes/new`);
    const review = combo(QA_SETUP.review).closest('.qa-field')!;
    expect(plain(review.textContent)).toContain('В тесте есть пояснения. Ученики увидят их вместе с верными ответами — после закрытия.');
    pick(QA_SETUP.review, QA_SETUP.reviewOption('answers'));
    expect(plain(review.textContent)).toContain('В тесте есть пояснения. Ученики увидят их вместе с верными ответами — сразу.');
    pick(QA_SETUP.review, QA_SETUP.reviewOption('score'));
    expect(plain(review.textContent)).toContain('При этой настройке ученики их не увидят');
    // The subject with the explanation unticked: no longer in the set, no line.
    fireEvent.click(screen.getByRole('checkbox', { name: /Вариант 1/ }));
    expect(plain(review.textContent)).not.toContain('В тесте есть пояснения');
  });
});
