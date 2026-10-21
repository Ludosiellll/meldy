import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  createQuiz: vi.fn(),
  updateQuiz: vi.fn(),
  listQuizzes: vi.fn(),
  upload: vi.fn(),
  reload: vi.fn(),
  bring: vi.fn(),
  fetchDoc: vi.fn(),
  state: { summary: null as unknown, items: null as unknown },
}));

vi.mock('../../api/quizzes', () => ({ createQuiz: api.createQuiz, updateQuiz: api.updateQuiz, listQuizzes: api.listQuizzes }));
// The cover goes to storage through uploadPicture; its address is the public bucket's (here a made-up host).
vi.mock('../../api/itemPictures', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/itemPictures')>()),
  uploadPicture: api.upload,
  coverUrl: (path: string) => `https://covers.test/${path}`,
}));
vi.mock('../../components/test/bringIntoView', () => ({ bringIntoView: api.bring }));
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
  api.bring.mockReset();
  api.fetchDoc.mockReset().mockResolvedValue(null);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 });
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
    expect(plain(subjects.textContent)).toContain('Возьмём только вопросы с верным ответом. В выбранных предметах их 30.');
    expect(combo(QA_SETUP.count)).toHaveTextContent('20');
    expect(combo(QA_SETUP.time)).toHaveTextContent('20 мин');
    expect(combo(QA_SETUP.set)).toHaveTextContent(QA_SETUP.setOwn);
    expect(combo(QA_SETUP.order)).toHaveTextContent(QA_SETUP.orderShuffle);
    expect(combo(QA_SETUP.options)).toHaveTextContent(QA_SETUP.optionsShuffle);
    expect(combo(QA_SETUP.opens)).toHaveTextContent(QA_SETUP.opensNow);
    expect(combo(QA_SETUP.closes)).toHaveTextContent(QA_SETUP.closesAt);
    expect(screen.getByLabelText(QA_SETUP.closesField)).toHaveValue(localInput(weekOn(NOW)));
    expect(combo(QA_SETUP.attempts)).toHaveTextContent('1');
    // «Засчитать» only matters with more than one attempt.
    expect(screen.queryByRole('combobox', { name: QA_SETUP.grading })).toBeNull();
    expect(combo(QA_SETUP.pass)).toHaveTextContent(QA_SETUP.passNone);
    expect(combo(QA_SETUP.review)).toHaveTextContent(QA_SETUP.reviewOption('answers'));
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
    expect(combo(QA_SETUP.grading)).toHaveTextContent('лучшую попытку');
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
      review: 'answers',
      members_only: false,
      guests: true,
      cover_path: null,
      accent: 'blue',
      offer_practice: false,
      protection: 'off',
      protection_limit: 3,
    });
    expect(await screen.findByTestId('where')).toHaveTextContent(`/exams/c/${EXAM}/quizzes/new-quiz|{"quizNote":"created"}`);
  });

  it('«Защита от списывания»: three levels with their lines; the strict one adds the limit and sends it', async () => {
    renderAt(`/exams/c/${EXAM}/quizzes/new`);
    await screen.findByRole('button', { name: QA_SETUP.create });
    const group = screen.getByRole('group', { name: QA_SETUP.protection });
    const off = screen.getByRole('radio', { name: new RegExp(`^${QA_SETUP.protectionOption('off')}`) });
    expect(off).toBeChecked();
    // every level says what it does in one line; what a site cannot see comes with a level that records
    expect(group).toHaveTextContent(QA_SETUP.protectionHint('off', 3));
    expect(group).not.toHaveTextContent(QA_SETUP.protectionLimits);
    expect(screen.queryByRole('combobox', { name: QA_SETUP.protectionLimit })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: new RegExp(`^${QA_SETUP.protectionOption('strict')}`) }));
    expect(group).toHaveTextContent('Второй телефон и фото экрана сайт не заметит.');
    // the rest of the words folded under «Подробнее»
    expect(within(group).getByText(QA_SETUP.protectionMore).closest('details')).not.toHaveAttribute('open');
    pick(QA_SETUP.protectionLimit, QA_SETUP.protectionLimitOption(5));
    fireEvent.click(screen.getByRole('button', { name: QA_SETUP.create }));
    await waitFor(() => expect(api.createQuiz).toHaveBeenCalledTimes(1));
    expect(api.createQuiz.mock.calls[0][1]).toMatchObject({ protection: 'strict', protection_limit: 5 });
  });

  it('says a refusal of the server and stays', async () => {
    api.createQuiz.mockRejectedValue(new ContainerApiError('MC010', 'Уже 50 контрольных. Удалите старые, чтобы создать новую.'));
    renderAt(`/exams/c/${EXAM}/quizzes/new`);
    fireEvent.click(screen.getByRole('button', { name: QA_SETUP.create }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Уже 50 контрольных.');
    expect(screen.getByRole('button', { name: QA_SETUP.create })).toBeEnabled();
  });
});

describe('QuizSetupPage: who writes, the look, the offer to train (release 47, spec §47.1, §47.4, §47.5)', () => {
  it('«Кто может писать» has three choices, the hint says what the chosen one means, and the flags go with it', async () => {
    renderAt(`/exams/c/${EXAM}/quizzes/new`);
    fireEvent.click(combo(QA_SETUP.who));
    expect(screen.getAllByRole('option').map((node) => node.textContent)).toEqual([
      'все по ссылке, без входа',
      'все по ссылке, после входа',
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
    expect(QA_SETUP.whoHint('guests')).toBe('Аккаунт не нужен. Попытки считаем по браузеру, в другом браузере можно начать заново.');
  });

  it('without an account and «балл, ошибки и верные ответы»: a hint under the review names the safer choice', async () => {
    const HINT =
      'Без входа ученик может открыть тест в другом браузере и заранее увидеть ответы. ' +
      'Лучше выбрать «балл и ошибки сразу, ответы и пояснения после закрытия».';
    expect(QA_SETUP.reviewGuests).toBe(HINT);
    expect(QA_SETUP.reviewGuests).toContain(`«${QA_SETUP.reviewOption('mistakes_then_answers')}»`);
    renderAt(`/exams/c/${EXAM}/quizzes/new`);
    // The defaults (guests, the right answers at once, owner 21.10): the hint names the safer choice.
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
    // Any picture (a phone opens its photos): pictureFromFile redraws what the bucket does not take.
    expect(input.accept).toBe('image/*');
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

  it('«После сдачи предложить тренировать эти вопросы в Meldy» with its note', async () => {
    renderAt(`/exams/c/${EXAM}/quizzes/new`);
    const toggle = screen.getByRole('checkbox', { name: 'После сдачи предложить тренировать эти вопросы в Meldy' });
    // The questions, not «этому экзамену» (release 47.1).
    expect(document.body.textContent).not.toContain('по этому экзамену');
    expect(toggle).toHaveAccessibleDescription(
      'Кнопка появится после закрытия контрольной. В тренировке видны все ответы экзамена. ' +
        'Кто согласится, появится в списке участников экзамена. Его прогресс вы не увидите.',
    );
    // No «Участник станет участником»: the words say what happens and when.
    expect(document.body.textContent).not.toContain('станет участником');
    expect(screen.getByText(QA_SETUP.practiceNote)).toHaveClass('im-hint');
    fireEvent.click(toggle);
    expect(screen.getByText(QA_SETUP.practiceNote)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: QA_SETUP.create }));
    await waitFor(() => expect(api.createQuiz).toHaveBeenCalledWith(EXAM, expect.objectContaining({ offer_practice: true })));
  });

  it('a test’s quiz: the offer to train names the test’s questions and participants, «Кто может писать» the test’s members (release 47.3)', async () => {
    api.state.summary = examSummary({ kind: 'test' });
    renderAt(`/exams/c/${EXAM}/quizzes/new`);
    const toggle = screen.getByRole('checkbox', { name: 'После сдачи предложить тренировать эти вопросы в Meldy' });
    expect(toggle).toHaveAccessibleDescription(
      'Кнопка появится после закрытия контрольной. В тренировке видны все ответы теста. ' +
        'Кто согласится, появится в списке участников теста. Его прогресс вы не увидите.',
    );
    expect(screen.queryByText(QA_SETUP.practiceNote)).toBeNull();
    pick(QA_SETUP.who, QA_SETUP.whoOption('members', true));
    expect(QA_SETUP.whoOption('members', true)).toBe('только участники этого теста');
    expect(screen.getByText(QA_SETUP.whoHint('members', true))).toBeInTheDocument();
    expect(QA_SETUP.whoHint('members', true)).toContain('вступил в этот тест');
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

  it('named as the test; six settings in view (what the taker sees after: owner 21.10), the rest under «Ещё настройки», folded', () => {
    renderAt(`/exams/c/${EXAM}/quizzes/new?all=1`);
    expect(screen.getByLabelText(QA_SETUP.name)).toHaveValue('Зимняя сессия');
    const main = screen.getByRole('region', { name: QA_SETUP.partMain });
    expect(within(main).getByLabelText(QA_SETUP.name)).toBeInTheDocument();
    expect(within(main).getByRole('combobox', { name: QA_SETUP.time })).toBeInTheDocument();
    expect(within(main).getByRole('combobox', { name: QA_SETUP.closes })).toBeInTheDocument();
    expect(within(main).getByRole('combobox', { name: QA_SETUP.who })).toBeInTheDocument();
    expect(within(main).getByRole('combobox', { name: QA_SETUP.review })).toHaveTextContent(QA_SETUP.reviewOption('answers'));
    expect(screen.getByRole('region', { name: QA_SETUP.partLook })).toBeInTheDocument();
    const button = more();
    expect(button).toHaveAttribute('aria-expanded', 'false');
    const folded = document.getElementById(button.getAttribute('aria-controls') ?? '')!;
    expect(folded).not.toBeVisible();
    for (const name of [QA_SETUP.count, QA_SETUP.set, QA_SETUP.order, QA_SETUP.options, QA_SETUP.opens, QA_SETUP.attempts, QA_SETUP.pass]) {
      expect(screen.queryByRole('combobox', { name })).toBeNull();
    }
    expect(screen.queryByRole('group', { name: QA_SETUP.subjects })).toBeNull();
    expect(screen.queryByRole('checkbox', { name: QA_SETUP.practice })).toBeNull();
    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(folded).toBeVisible();
    for (const name of [QA_SETUP.count, QA_SETUP.set, QA_SETUP.order, QA_SETUP.options, QA_SETUP.opens, QA_SETUP.attempts, QA_SETUP.pass]) {
      expect(within(folded).getByRole('combobox', { name })).toBeInTheDocument();
    }
    expect(within(folded).getByRole('group', { name: QA_SETUP.subjects })).toBeInTheDocument();
    expect(within(folded).getByRole('checkbox', { name: QA_SETUP.practice })).toBeInTheDocument();
    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(folded).not.toBeVisible();
  });

  it('a computer: «Ещё настройки» on top of the right column, before «Оформление» (in view at 734 px); opened, the window shows where the folded cards begin (release 47.1)', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1532 });
    renderAt(`/exams/c/${EXAM}/quizzes/new?all=1`);
    const button = more();
    const main = screen.getByRole('region', { name: QA_SETUP.partMain });
    const look = screen.getByRole('region', { name: QA_SETUP.partLook });
    expect(main.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(button.compareDocumentPosition(look) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(button.parentElement).toHaveAttribute('data-side', '');
    fireEvent.click(button);
    expect(api.bring).toHaveBeenCalledTimes(1);
    const [first, last] = api.bring.mock.calls[0] as [HTMLElement, HTMLElement];
    expect(first).toBe(document.getElementById(button.getAttribute('aria-controls') ?? ''));
    expect(last).toHaveTextContent(QA_SETUP.partQuestions);
    // Folding moves nothing.
    fireEvent.click(button);
    expect(api.bring).toHaveBeenCalledTimes(1);
  });

  it('a phone: «Ещё настройки» under «Оформление», the folded settings right under it; the window stays', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
    renderAt(`/exams/c/${EXAM}/quizzes/new?all=1`);
    const button = more();
    const look = screen.getByRole('region', { name: QA_SETUP.partLook });
    expect(look.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(button.parentElement).not.toHaveAttribute('data-side');
    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(api.bring).not.toHaveBeenCalled();
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
    // «Защита от списывания» is locked with the timer: the rules a participant read before the start hold
    expect(screen.getByRole('group', { name: QA_SETUP.protection })).toBeDisabled();
    for (const name of [QA_SETUP.count, QA_SETUP.set, QA_SETUP.order, QA_SETUP.options, QA_SETUP.time]) expect(combo(name)).toBeDisabled();
    for (const name of [QA_SETUP.attempts, QA_SETUP.pass, QA_SETUP.review, QA_SETUP.who, QA_SETUP.closes]) expect(combo(name)).toBeEnabled();
    expect(combo(QA_SETUP.attempts)).toHaveTextContent('3');
    pick(QA_SETUP.attempts, '5');
    pick(QA_SETUP.grading, 'последнюю попытку');
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
    expect(plain(count.textContent)).toContain('Возьмём только вопросы с верным ответом. Их 15.');
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

  it('the review shows the right answers at once by default (owner 21.10); no explanations in the set — no line', () => {
    expect(QA_SETUP.reviewOption('mistakes_then_answers')).toBe('балл и ошибки сразу, ответы и пояснения после закрытия');
    renderAt(`/exams/c/${EXAM}/quizzes/new`);
    expect(combo(QA_SETUP.review)).toHaveTextContent(QA_SETUP.reviewOption('answers'));
    expect(screen.queryByText(/Пояснения ученики увидят/)).toBeNull();
  });

  it('a question of the set with an explanation: a line under the review says when the takers see it', () => {
    const items = examItems();
    items.set('i37', { ...items.get('i37')!, explanation: 'Два знака равенства сравнивают значения.' });
    api.state.items = items;
    renderAt(`/exams/c/${EXAM}/quizzes/new`);
    const review = combo(QA_SETUP.review).closest('.qa-field')!;
    expect(plain(review.textContent)).toContain('Пояснения ученики увидят сразу, вместе с верными ответами.');
    pick(QA_SETUP.review, QA_SETUP.reviewOption('mistakes_then_answers'));
    expect(plain(review.textContent)).toContain('Пояснения ученики увидят после закрытия, вместе с верными ответами.');
    pick(QA_SETUP.review, QA_SETUP.reviewOption('score'));
    expect(plain(review.textContent)).toContain('При этой настройке пояснения не видны.');
    // The subject with the explanation unticked: no longer in the set, no line.
    fireEvent.click(screen.getByRole('checkbox', { name: /Вариант 1/ }));
    expect(plain(review.textContent)).not.toContain('Пояснения ученики увидят');
    expect(plain(review.textContent)).not.toContain('пояснения не видны');
  });
});

describe('QuizSetupPage: a quiz «как в студии» (?all=1&design=1, the studio’s «Отправить по ссылке»; release 47.2)', () => {
  /** The studio's page: three keyed questions of the exam, one without a key, one whose row is gone. */
  function page(itemIds = ['i37', 'nokey', 'i3', 'i5', 'gone-row']) {
    return {
      container_id: EXAM,
      rev: 2,
      updated_at: '2026-10-16T10:00:00Z',
      doc: {
        v: 1,
        title: 'Кислоты и основания',
        theme: {},
        layout: 'one_by_one',
        blocks: itemIds.map((id, index) => ({ type: 'question', id: `quest000000${index}`, item_id: id, points: 1, required: false })),
        results: { bands: [], cta: null },
      },
    };
  }
  const more = () => screen.getByRole('button', { name: /^Ещё настройки/ });

  it('one quiet line and the way back to the studio; what the page decides is not asked; the page’s name, count and timer', async () => {
    api.fetchDoc.mockResolvedValue(page());
    renderAt(`/exams/c/${EXAM}/quizzes/new?all=1&design=1`);
    const toggle = screen.getByRole('checkbox', { name: QA_SETUP.design });
    expect(toggle).toBeChecked();
    expect(described(toggle)).toBe(`${QA_SETUP.designLine} ${QA_SETUP.toStudio}`);
    expect(screen.getByRole('link', { name: QA_SETUP.toStudio })).toHaveAttribute('href', `/exams/c/${EXAM}/studio`);
    await waitFor(() => expect(screen.getByLabelText(QA_SETUP.name)).toHaveValue('Кислоты и основания'));
    expect(api.fetchDoc).toHaveBeenCalledWith(EXAM);
    expect(combo(QA_SETUP.time)).toHaveTextContent('5 мин');
    expect(screen.queryByRole('region', { name: QA_SETUP.partLook })).toBeNull();
    expect(more()).toHaveTextContent(QA_SETUP.moreNoteDesign);
    fireEvent.click(more());
    expect(screen.queryByRole('group', { name: QA_SETUP.subjects })).toBeNull();
    for (const name of [QA_SETUP.count, QA_SETUP.set, QA_SETUP.order]) expect(screen.queryByRole('combobox', { name })).toBeNull();
    expect(combo(QA_SETUP.options)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: QA_SETUP.create }));
    await waitFor(() =>
      expect(api.createQuiz).toHaveBeenCalledWith(EXAM, expect.objectContaining({ design: true, title: 'Кислоты и основания', item_count: 3, time_limit_min: 5 })),
    );
  });

  it('a page without a keyed question says so before «Создать»', async () => {
    api.fetchDoc.mockResolvedValue(page(['nokey']));
    renderAt(`/exams/c/${EXAM}/quizzes/new?all=1&design=1`);
    expect(await screen.findByText(QA_SETUP.problems.page)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: QA_SETUP.create })).toBeDisabled();
  });

  it('the server finds no question on the page (MC013): said in the page’s words', async () => {
    api.fetchDoc.mockRejectedValue(new Error('offline'));
    api.createQuiz.mockRejectedValue(new ContainerApiError('MC013', 'В выбранных предметах нет вопросов с верным ответом.', { detail: 'no_questions' }));
    renderAt(`/exams/c/${EXAM}/quizzes/new?all=1&design=1`);
    fireEvent.click(screen.getByRole('button', { name: QA_SETUP.create }));
    expect(await screen.findByText(QA_SETUP.problems.page)).toBeInTheDocument();
  });

  it('switched off: the subjects, the count of all of them and the timer come back; nothing about the page is sent', async () => {
    api.fetchDoc.mockResolvedValue(page());
    renderAt(`/exams/c/${EXAM}/quizzes/new?all=1&design=1`);
    await waitFor(() => expect(combo(QA_SETUP.time)).toHaveTextContent('5 мин'));
    fireEvent.click(screen.getByRole('checkbox', { name: QA_SETUP.design }));
    expect(described(screen.getByRole('checkbox', { name: QA_SETUP.design }))).toBe(`${QA_SETUP.designOff} ${QA_SETUP.toStudio}`);
    expect(screen.getByRole('region', { name: QA_SETUP.partLook })).toBeInTheDocument();
    fireEvent.click(more());
    expect(screen.getByRole('group', { name: QA_SETUP.subjects })).toBeInTheDocument();
    expect(combo(QA_SETUP.count)).toHaveTextContent('все (30)');
    expect(combo(QA_SETUP.time)).toHaveTextContent('30 мин');
    fireEvent.click(screen.getByRole('button', { name: QA_SETUP.create }));
    await waitFor(() => expect(api.createQuiz).toHaveBeenCalledWith(EXAM, expect.objectContaining({ design: false, item_count: 30 })));
  });

  it('a started quiz «как в студии»: the switch shown, locked like the set; the rest still changes', async () => {
    api.listQuizzes.mockResolvedValue([listRow({ design: true })]);
    api.fetchDoc.mockResolvedValue(page());
    renderAt(`/exams/c/${EXAM}/quizzes/${QUIZ_ID}/edit`);
    expect(await screen.findByText(QA_SETUP.lockedDesign)).toBeInTheDocument();
    const toggle = screen.getByRole('checkbox', { name: QA_SETUP.design });
    expect(toggle).toBeChecked();
    expect(toggle).toBeDisabled();
    expect(screen.queryByRole('group', { name: QA_SETUP.subjects })).toBeNull();
    expect(screen.queryByRole('combobox', { name: QA_SETUP.count })).toBeNull();
    pick(QA_SETUP.attempts, '5');
    fireEvent.click(screen.getByRole('button', { name: QA_SETUP.save }));
    await waitFor(() => expect(api.updateQuiz).toHaveBeenCalledWith(QUIZ_ID, { attempts: 5 }));
  });

  it('before the start the switch can go off (sent alone); a quiz that never had it shows none', async () => {
    api.listQuizzes.mockResolvedValue([listRow({ design: true, started: false })]);
    api.fetchDoc.mockResolvedValue(page());
    renderAt(`/exams/c/${EXAM}/quizzes/${QUIZ_ID}/edit`);
    const toggle = await screen.findByRole('checkbox', { name: QA_SETUP.design });
    expect(toggle).toBeEnabled();
    fireEvent.click(toggle);
    fireEvent.click(screen.getByRole('button', { name: QA_SETUP.save }));
    await waitFor(() => expect(api.updateQuiz).toHaveBeenCalledWith(QUIZ_ID, { design: false }));
    cleanup();
    api.listQuizzes.mockResolvedValue([listRow()]);
    renderAt(`/exams/c/${EXAM}/quizzes/${QUIZ_ID}/edit`);
    await screen.findByRole('heading', { level: 2, name: QA_SETUP.partQuestions });
    expect(screen.queryByRole('checkbox', { name: QA_SETUP.design })).toBeNull();
  });
});
