import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { QuizAttempt, QuizAttemptItem, QuizPreview, QuizPreviewMe, QuizResult } from '../../types/quiz';
import type { DocDesign } from '../../types/testDoc';

const api = vi.hoisted(() => ({
  previewQuiz: vi.fn(),
  startQuiz: vi.fn(),
  sendAnswers: vi.fn(),
  finishQuiz: vi.fn(),
  quizResult: vi.fn(),
  claimGuestAttempts: vi.fn(),
  joinPractice: vi.fn(),
  previewAsGuest: vi.fn(),
  track: vi.fn(),
  pictureUrl: vi.fn(),
  guestPictureUrl: vi.fn(),
  auth: { user: null as null | { id: string }, loading: false },
}));
vi.mock('../../api/quizzes', () => ({
  previewQuiz: api.previewQuiz,
  startQuiz: api.startQuiz,
  sendAnswers: api.sendAnswers,
  finishQuiz: api.finishQuiz,
  quizResult: api.quizResult,
  claimGuestAttempts: api.claimGuestAttempts,
  joinPractice: api.joinPractice,
  previewAsGuest: api.previewAsGuest,
}));
vi.mock('../../api/itemPictures', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/itemPictures')>()),
  coverUrl: (path: string) => `https://covers.test/${path}`,
  pictureUrl: api.pictureUrl,
  guestPictureUrl: api.guestPictureUrl,
}));
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: api.auth.user, loading: api.auth.loading, requestSession: vi.fn() }) }));
vi.mock('../../lib/supabase', () => ({ supabase: { rpc: vi.fn(), auth: { signInWithOAuth: vi.fn() }, storage: { from: vi.fn() } } }));
vi.mock('../../lib/telemetry', () => ({ track: api.track }));

import QuizTakePage from './QuizTakePage';
import { ContainerApiError } from '../../api/containers';
import { storeKey } from '../../components/quiz/QuizRun';
import { QUIZ_ERRORS } from '../../components/quiz/copyQuiz';
import { TOKEN_RE, dropGuestToken, ensureGuestToken, guestToken } from '../../lib/quizzes/guestToken';
import { dateTimeText } from '../../lib/quizzes/quizModel';

const NB = String.fromCharCode(0xa0);
const plain = (text: string | null | undefined) => (text ?? '').split(NB).join(' ');
const page = () => plain(document.body.textContent);
/** «Имя и фамилия — их увидит Анна Петрова» (the preview's author). */
const NAME_LABEL = /^Имя и фамилия — их увидит /;
const labelOf = (field: HTMLElement) => plain((field as HTMLInputElement).labels?.[0]?.textContent);
const bar = () => plain(document.querySelector('.ct-rb-long')?.textContent);
const options = () => Array.from(document.querySelectorAll<HTMLButtonElement>('.ct-opts .ct-opt'));

const CODE = 'abcd2fghjkmn';
const SERVER_NOW = '2026-10-16T10:00:00.000Z';
/** The device's clock is two minutes ahead of the server's. */
const DEVICE_NOW = Date.parse('2026-10-16T10:02:00.000Z');
const CLOSES = new Date(2026, 9, 24, 18, 0).toISOString();

const PREVIEW: QuizPreview = {
  status: 'open',
  title: 'Контрольная по базам данных',
  exam_title: 'Зимняя сессия',
  author_name: 'Анна Петрова',
  item_count: 20,
  time_limit_s: 1800,
  opens_at: null,
  closes_at: CLOSES,
  attempts: 1,
  grading: 'best',
  allow_back: true,
  pass_percent: null,
  review: 'mistakes_then_answers',
  members_only: false,
  server_now: SERVER_NOW,
  me: null,
};

const ME: QuizPreviewMe = {
  name_hint: 'Иван Иванов',
  is_author: false,
  is_member: false,
  attempts_used: 0,
  open_attempt: null,
  can_start: true,
  reason: null,
  results: [],
};

const ITEMS: QuizAttemptItem[] = [
  { id: 'i1', kind: 'single', stem: 'Сколько будет 2 + 2?', options: ['3', '4', '5'], code: false, keep_order: false, images: null },
  { id: 'i2', kind: 'single', stem: 'Какой цвет у неба?', options: ['Зелёный', 'Синий'], code: false, keep_order: false, images: null },
  { id: 'i3', kind: 'short', stem: 'Столица Франции', options: [], code: false, keep_order: false, images: null },
];

const ATTEMPT: QuizAttempt = {
  attempt_id: 'att-1',
  n: 1,
  quiz_title: 'Контрольная по базам данных',
  server_now: SERVER_NOW,
  started_at: SERVER_NOW,
  deadline_at: '2026-10-16T10:30:00.000Z',
  allow_back: true,
  shuffle_options: false,
  items: ITEMS,
  answers: [],
};

const RESULT: QuizResult = {
  attempt_id: 'att-1',
  n: 1,
  quiz_title: 'Контрольная по базам данных',
  code: CODE,
  started_at: SERVER_NOW,
  finished_at: '2026-10-16T10:30:00.000Z',
  finish_reason: 'time',
  correct: 1,
  total: 3,
  percent: 33,
  pass_percent: null,
  passed: null,
  review_now: 'score',
  answers_after: null,
  attempts_left: 1,
  can_retry: true,
  items: [],
};

let where = '';
function Where() {
  const location = useLocation();
  where = `${location.pathname}${location.search}`;
  return <p>Вход</p>;
}

/** «Me» of a visitor without an account, by the device's token (release 47). */
const GUEST_ME: QuizPreviewMe = { ...ME, name_hint: null, guest: true };
const GUEST_PREVIEW: QuizPreview = { ...PREVIEW, guests: true, me: GUEST_ME };
const GUEST_PRIVACY = 'Автор увидит имя, которое вы укажете, ваши ответы и результат. Попытки сохраняются в этом браузере.';
const BACK_HERE = `/login?next=${encodeURIComponent(`/k/${CODE}`)}`;

function renderAt(code = CODE, search = '') {
  return render(
    <MemoryRouter initialEntries={[`/k/${code}${search}`]}>
      <Routes>
        <Route path="/k/:code" element={<QuizTakePage />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

function signedIn(me: Partial<QuizPreviewMe> = {}, preview: Partial<QuizPreview> = {}) {
  api.auth.user = { id: 'user-1' };
  api.previewQuiz.mockResolvedValue({ ...PREVIEW, ...preview, me: { ...ME, ...me } });
}

beforeEach(() => {
  // Only Date: the half second of the sending and the second of the clock run as they do.
  vi.useFakeTimers({ now: DEVICE_NOW, toFake: ['Date'] });
  window.localStorage.clear();
  // The token module keeps a copy in memory too (a private window): forget it between the tests.
  dropGuestToken(CODE);
  where = '';
  api.auth.user = null;
  api.auth.loading = false;
  api.previewQuiz.mockReset().mockResolvedValue(PREVIEW);
  api.startQuiz.mockReset().mockResolvedValue(ATTEMPT);
  api.sendAnswers.mockReset().mockResolvedValue({ saved: 1, server_now: SERVER_NOW, deadline_at: ATTEMPT.deadline_at });
  api.finishQuiz.mockReset().mockResolvedValue(RESULT);
  api.quizResult.mockReset().mockResolvedValue(RESULT);
  api.claimGuestAttempts.mockReset().mockResolvedValue({ claimed: 0 });
  api.joinPractice.mockReset().mockResolvedValue({ container_id: 'cont-1' });
  api.previewAsGuest.mockReset().mockResolvedValue({ ...PREVIEW, guests: true, me: { ...ME, name_hint: null, guest: true } });
  api.track.mockReset();
  api.pictureUrl.mockReset().mockResolvedValue('blob:signed-in');
  api.guestPictureUrl.mockReset().mockResolvedValue('blob:guest');
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('/k/<код> before the start (spec §2.2)', () => {
  it('signed out: what it is, who sees what, and sign-in that comes back here', async () => {
    renderAt();
    expect(await screen.findByRole('heading', { level: 1, name: 'Контрольная по базам данных' })).toBeInTheDocument();
    expect(api.previewQuiz).toHaveBeenCalledWith(CODE, null);
    expect(page()).toContain('автор: Анна Петрова');
    expect(page()).toContain('экзамен «Зимняя сессия»');
    expect(page()).toContain('20 вопросов · 30 минут · открыта до 24 окт., 18:00 · 1 попытка');
    expect(page()).toContain('К вопросам можно возвращаться');
    const privacy = screen.getByText('Автор увидит имя, которое вы укажете, ваши ответы и результат.');
    const signIn = screen.getByRole('link', { name: 'Войти, чтобы начать' });
    expect(signIn).toHaveAttribute('href', `/login?next=${encodeURIComponent(`/k/${CODE}`)}`);
    expect(signIn).toHaveClass('sf-primary');
    // The rules and the line about the author come under the button, so it stays in view.
    expect(privacy.compareDocumentPosition(signIn) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Начать' })).toBeNull();
    expect(screen.queryByLabelText(NAME_LABEL)).toBeNull();
    // A quiz that wants an account says nothing about a browser keeping attempts, and makes no token.
    expect(screen.queryByText(GUEST_PRIVACY)).toBeNull();
    expect(screen.queryByText('Есть аккаунт?')).toBeNull();
    expect(guestToken(CODE)).toBeNull();
    fireEvent.click(signIn);
    expect(where).toBe(`/login?next=${encodeURIComponent(`/k/${CODE}`)}`);
  });

  it('no timer, attempts without limit, only forward, a pass mark', async () => {
    api.previewQuiz.mockResolvedValue({ ...PREVIEW, time_limit_s: null, attempts: null, allow_back: false, pass_percent: 60, closes_at: null });
    renderAt();
    await screen.findByRole('heading', { level: 1, name: 'Контрольная по базам данных' });
    expect(page()).toContain('20 вопросов · без ограничения времени · попыток сколько угодно');
    expect(page()).toContain('Только вперёд: к прошлым вопросам вернуться нельзя.');
    expect(page()).toContain('Проходной балл 60 %.');
    expect(page()).toContain('В зачёт идёт лучшая попытка.');
  });

  it('a link the database does not know', async () => {
    api.previewQuiz.mockResolvedValue({ status: 'not_found' });
    renderAt();
    expect(await screen.findByRole('alert')).toHaveTextContent('Такой контрольной нет. Проверьте ссылку.');
    expect(screen.queryByRole('link', { name: 'Войти, чтобы начать' })).toBeNull();
  });

  it('a code that cannot be one is not asked for', async () => {
    renderAt('nope');
    expect(await screen.findByRole('alert')).toHaveTextContent('Такой контрольной нет. Проверьте ссылку.');
    expect(api.previewQuiz).not.toHaveBeenCalled();
  });

  it('a failed preview can be tried again', async () => {
    api.previewQuiz.mockRejectedValueOnce(new ContainerApiError('network', 'Нет сети — попробуем ещё раз, когда она появится.', { status: 0 }));
    renderAt();
    fireEvent.click(await screen.findByRole('button', { name: 'Попробовать ещё раз' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Контрольная по базам данных' })).toBeInTheDocument();
  });
});

describe('/k/<код> signed in', () => {
  it('the name comes from the profile; «Начать» starts with the name typed', async () => {
    signedIn();
    renderAt();
    const field = await screen.findByLabelText(NAME_LABEL);
    expect(field).toHaveValue('Иван Иванов');
    // The field's label says who sees the name; what else the author sees comes under «Начать».
    expect(labelOf(field)).toBe('Имя и фамилия — их увидит Анна Петрова');
    expect(field).toHaveAccessibleDescription(/^Например: Иванов Иван, 9\sБ$/);
    const start = screen.getByRole('button', { name: 'Начать' });
    expect(screen.getByText('Автор увидит имя, которое вы укажете, ваши ответы и результат.').compareDocumentPosition(start) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
    fireEvent.change(field, { target: { value: '  Иванов Иван, гр. 21 ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Начать' }));
    await waitFor(() => expect(api.startQuiz).toHaveBeenCalledWith(CODE, 'Иванов Иван, гр. 21', null));
    // The attempt: the clock from the server's deadline (the device is two minutes ahead).
    await waitFor(() => expect(bar()).toBe('1 из 3 · осталось 30:00'));
    expect(api.track).toHaveBeenCalledWith('quiz.started', { resumed: false, guest: false });
  });

  it('a name shorter than 2 characters is not sent', async () => {
    signedIn({ name_hint: '' });
    renderAt();
    fireEvent.change(await screen.findByLabelText(NAME_LABEL), { target: { value: ' И ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Начать' }));
    expect(await screen.findByText('Имя — от 2 до 80 знаков.')).toBeInTheDocument();
    expect(screen.getByLabelText(NAME_LABEL)).toHaveAttribute('aria-invalid', 'true');
    expect(api.startQuiz).not.toHaveBeenCalled();
  });

  it.each([
    ['no_attempts', {}, 'Попытки закончились.'],
    ['members_only', {}, 'Эта контрольная только для участников экзамена.'],
    ['not_yet', { status: 'not_yet', opens_at: new Date(2026, 9, 18, 9, 0).toISOString() }, 'Контрольная откроется 18 окт., 09:00.'],
    ['closed', { status: 'closed' }, 'Контрольная закрыта.'],
  ] as const)('%s: says why, without «Начать»', async (reason, preview, words) => {
    signedIn({ reason, can_start: false }, preview as Partial<QuizPreview>);
    renderAt();
    await screen.findByRole('heading', { level: 1, name: 'Контрольная по базам данных' });
    await waitFor(() => expect(page()).toContain(words));
    expect(screen.queryByRole('button', { name: 'Начать' })).toBeNull();
    expect(screen.queryByLabelText(NAME_LABEL)).toBeNull();
  });

  it('a profile without a name leaves the field empty', async () => {
    signedIn({ name_hint: null });
    renderAt();
    expect(await screen.findByLabelText(NAME_LABEL)).toHaveValue('');
  });

  it('a quiz deleted since the preview (P0002) is said as a link that does not work', async () => {
    signedIn();
    api.startQuiz.mockRejectedValue(new ContainerApiError('P0002', 'Не найдено', { status: 400 }));
    renderAt();
    await screen.findByLabelText(NAME_LABEL);
    fireEvent.click(screen.getByRole('button', { name: 'Начать' }));
    expect(await screen.findByText('Такой контрольной нет. Проверьте ссылку.')).toBeInTheDocument();
  });

  it('a session that ended on the way leads to sign-in, back here', async () => {
    signedIn();
    api.startQuiz.mockRejectedValue(new ContainerApiError('42501', 'Нет доступа', { status: 401 }));
    renderAt();
    await screen.findByLabelText(NAME_LABEL);
    fireEvent.click(screen.getByRole('button', { name: 'Начать' }));
    expect(await screen.findByText(/Вход закончился/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Войти' })).toHaveAttribute('href', `/login?next=${encodeURIComponent(`/k/${CODE}`)}`);
  });

  it('a refusal of the start is said in words', async () => {
    signedIn();
    api.startQuiz.mockRejectedValue(new ContainerApiError('MC014', 'Попытки закончились.', { status: 400, detail: 'attempts' }));
    renderAt();
    await screen.findByLabelText(NAME_LABEL);
    fireEvent.click(screen.getByRole('button', { name: 'Начать' }));
    expect(await screen.findByText('Попытки закончились.')).toBeInTheDocument();
  });

  it('earlier results open from the page and «Закрыть» comes back', async () => {
    signedIn({ attempts_used: 1, results: [{ attempt_id: 'att-0', n: 1, finished_at: '2026-10-15T12:00:00.000Z', correct: 12, total: 20 }] });
    api.quizResult.mockResolvedValue({ ...RESULT, attempt_id: 'att-0', correct: 12, total: 20, percent: 60, finish_reason: 'sent' });
    renderAt();
    expect(await screen.findByRole('heading', { name: 'Ваши попытки' })).toBeInTheDocument();
    expect(page()).toContain('Попытка 1 · 12 из 20');
    fireEvent.click(screen.getByRole('button', { name: 'Посмотреть попытку 1' }));
    await waitFor(() => expect(api.quizResult).toHaveBeenCalledWith('att-0', null));
    await waitFor(() => expect(plain(document.querySelector('.qt-score')?.textContent)).toBe('12 из 20 · 60 %'));
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }));
    expect(await screen.findByLabelText(NAME_LABEL)).toBeInTheDocument();
    expect(api.previewQuiz).toHaveBeenCalledTimes(2);
  });

  it('the author is told the attempt does not count', async () => {
    signedIn({ is_author: true });
    renderAt();
    expect(await screen.findByText(/Это ваша контрольная/)).toBeInTheDocument();
  });
});

describe('/k/<код>: a reload in the middle of an attempt (review focus 1)', () => {
  it('«Продолжить» gives the same attempt: the answers back, unsent ones included, the clock from the server deadline', async () => {
    signedIn({ open_attempt: 'att-1', attempts_used: 1, can_start: false });
    // Ten minutes in; the device kept an answer the server never got before the reload.
    window.localStorage.setItem(storeKey('att-1'), JSON.stringify({ i2: [1] }));
    api.startQuiz.mockResolvedValue({
      ...ATTEMPT,
      server_now: '2026-10-16T10:10:00.000Z',
      answers: [{ item_id: 'i1', chosen: [1], text: null }],
    });
    api.sendAnswers.mockResolvedValue({ saved: 1, server_now: '2026-10-16T10:10:00.000Z', deadline_at: ATTEMPT.deadline_at });
    renderAt();
    const resume = await screen.findByRole('button', { name: 'Продолжить' });
    expect(screen.queryByLabelText(NAME_LABEL)).toBeNull();
    fireEvent.click(resume);
    await waitFor(() => expect(api.startQuiz).toHaveBeenCalledWith(CODE, 'Иван Иванов', null));
    // The first question without an answer is the third; 20 minutes are left, not 30.
    await waitFor(() => expect(bar()).toBe('3 из 3 · осталось 20:00'));
    expect(api.track).toHaveBeenCalledWith('quiz.started', { resumed: true, guest: false });
    await waitFor(() => expect(api.sendAnswers).toHaveBeenCalledWith('att-1', [{ item_id: 'i2', chosen: [1] }], null));
    fireEvent.click(screen.getByRole('button', { name: 'Назад' }));
    expect(options()[1]).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Назад' }));
    expect(options()[1]).toHaveAttribute('aria-pressed', 'true');
    expect(options()[0]).toHaveAttribute('aria-pressed', 'false');
  });
});

describe('/k/<код>: the attempt to its result', () => {
  it('an answer sent after the grace (MC012) shows the result (review focus 3)', async () => {
    signedIn();
    api.sendAnswers.mockRejectedValue(new ContainerApiError('MC012', 'Время вышло: ответы больше не принимаются.', { status: 400 }));
    renderAt();
    await screen.findByLabelText(NAME_LABEL);
    fireEvent.click(screen.getByRole('button', { name: 'Начать' }));
    await waitFor(() => expect(options().length).toBe(3));
    fireEvent.click(options()[1]);
    await waitFor(() => expect(api.quizResult).toHaveBeenCalledWith('att-1', null), { timeout: 2000 });
    await waitFor(() => expect(plain(document.querySelector('.qt-score')?.textContent)).toBe('1 из 3 · 33 %'));
    expect(page()).toContain('Время вышло — попытка закрылась сама.');
  });

  it('the time runs out: the attempt finishes by itself; «Ещё попытка» goes back to the start', async () => {
    signedIn({ attempts_used: 0 }, { attempts: 2 });
    renderAt();
    await screen.findByLabelText(NAME_LABEL);
    fireEvent.click(screen.getByRole('button', { name: 'Начать' }));
    await waitFor(() => expect(bar()).toBe('1 из 3 · осталось 30:00'));
    await act(async () => {
      vi.setSystemTime(Date.parse('2026-10-16T10:32:00.000Z'));
    });
    await waitFor(() => expect(api.finishQuiz).toHaveBeenCalledWith('att-1', null), { timeout: 3000 });
    const retry = await screen.findByRole('button', { name: (name) => plain(name) === 'Ещё попытка (осталась 1)' });
    fireEvent.click(retry);
    expect(await screen.findByLabelText(NAME_LABEL)).toBeInTheDocument();
    await waitFor(() => expect(api.previewQuiz).toHaveBeenCalledTimes(2));
  });
});

describe('/k/<код> without an account (release 47, spec §47.1)', () => {
  it('the name and «Начать» without signing in; the token is made at the start and goes with every call', async () => {
    api.previewQuiz.mockResolvedValue(GUEST_PREVIEW);
    api.finishQuiz.mockResolvedValue({ ...RESULT, finish_reason: 'sent', can_retry: false, practice: { exam_title: 'Зимняя сессия', member: false } });
    renderAt();
    const field = await screen.findByLabelText(NAME_LABEL);
    expect(field).toHaveValue('');
    // Before the start the device holds no token: the preview goes without one.
    expect(api.previewQuiz).toHaveBeenCalledWith(CODE, null);
    expect(guestToken(CODE)).toBeNull();
    const privacy = screen.getByText(GUEST_PRIVACY);
    expect(privacy.compareDocumentPosition(field) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Войти, чтобы начать' })).toBeNull();
    // For those with an account: a quiet «Войти» that comes back here.
    const quiet = screen.getByRole('link', { name: 'Войти' });
    expect(quiet).toHaveAttribute('href', BACK_HERE);
    expect(quiet).not.toHaveClass('sf-primary');
    expect(quiet.closest('p')).toHaveTextContent('Есть аккаунт? Войти');

    fireEvent.change(field, { target: { value: ' Пётр Сидоров, гр. 12 ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Начать' }));
    await waitFor(() => expect(api.startQuiz).toHaveBeenCalledTimes(1));
    const token = api.startQuiz.mock.calls[0][2] as string;
    expect(token).toMatch(TOKEN_RE);
    expect(api.startQuiz).toHaveBeenCalledWith(CODE, 'Пётр Сидоров, гр. 12', token);
    expect(guestToken(CODE)).toBe(token);
    expect(api.track).toHaveBeenCalledWith('quiz.started', { resumed: false, guest: true });

    await waitFor(() => expect(options().length).toBe(3));
    fireEvent.click(options()[1]);
    await waitFor(() => expect(api.sendAnswers).toHaveBeenCalledWith('att-1', [{ item_id: 'i1', chosen: [1] }], token), { timeout: 2000 });
    fireEvent.click(screen.getByRole('button', { name: 'Завершить' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Завершить' }));
    await waitFor(() => expect(api.finishQuiz).toHaveBeenCalledWith('att-1', token));
    // The result of a guest: training goes through making an account.
    expect(await screen.findByRole('link', { name: 'Создать аккаунт и тренироваться' })).toHaveAttribute(
      'href',
      `/register?next=${encodeURIComponent(`/k/${CODE}?practice=1`)}`,
    );
    expect(screen.queryByRole('button', { name: 'Тренировать эти вопросы' })).toBeNull();
  });

  it('a returning guest: the preview with the device’s token, «Продолжить» and the earlier results', async () => {
    const token = ensureGuestToken(CODE);
    api.previewQuiz.mockResolvedValue({
      ...GUEST_PREVIEW,
      me: { ...GUEST_ME, attempts_used: 2, open_attempt: 'att-1', can_start: false, results: [{ attempt_id: 'att-0', n: 1, finished_at: '2026-10-15T12:00:00.000Z', correct: 12, total: 20 }] },
    });
    api.quizResult.mockResolvedValue({ ...RESULT, attempt_id: 'att-0', correct: 12, total: 20, percent: 60, finish_reason: 'sent' });
    renderAt();
    expect(await screen.findByRole('button', { name: 'Продолжить' })).toBeInTheDocument();
    expect(api.previewQuiz).toHaveBeenCalledWith(CODE, token);
    expect(screen.queryByLabelText(NAME_LABEL)).toBeNull();
    expect(page()).toContain('Попытка 1 · 12 из 20');
    fireEvent.click(screen.getByRole('button', { name: 'Посмотреть попытку 1' }));
    await waitFor(() => expect(api.quizResult).toHaveBeenCalledWith('att-0', token));
    await waitFor(() => expect(plain(document.querySelector('.qt-score')?.textContent)).toBe('12 из 20 · 60 %'));
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Продолжить' }));
    // Going on: the server keeps the attempt's name; the same token.
    await waitFor(() => expect(api.startQuiz).toHaveBeenCalledWith(CODE, '', token));
    expect(api.track).toHaveBeenCalledWith('quiz.started', { resumed: true, guest: true });
  });

  it.each([
    ['MC016', 'busy', QUIZ_ERRORS.MC016_busy],
    ['MC017', 'guests', QUIZ_ERRORS.MC017_guests],
  ] as const)('%s at the start is said in the page’s words', async (code, detail, words) => {
    api.previewQuiz.mockResolvedValue(GUEST_PREVIEW);
    api.startQuiz.mockRejectedValue(new ContainerApiError(code, words, { status: 400, detail }));
    renderAt();
    fireEvent.change(await screen.findByLabelText(NAME_LABEL), { target: { value: 'Пётр' } });
    fireEvent.click(screen.getByRole('button', { name: 'Начать' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(words);
  });

  it('the author turned guests off since the preview (MC017): the page asks to sign in', async () => {
    api.previewQuiz.mockResolvedValueOnce(GUEST_PREVIEW).mockResolvedValue({ ...PREVIEW, guests: false, me: null });
    api.startQuiz.mockRejectedValue(new ContainerApiError('MC017', QUIZ_ERRORS.MC017_guests, { status: 400, detail: 'guests' }));
    renderAt();
    fireEvent.change(await screen.findByLabelText(NAME_LABEL), { target: { value: 'Пётр' } });
    fireEvent.click(screen.getByRole('button', { name: 'Начать' }));
    expect(await screen.findByRole('link', { name: 'Войти, чтобы начать' })).toHaveAttribute('href', BACK_HERE);
    expect(screen.getByRole('alert')).toHaveTextContent(QUIZ_ERRORS.MC017_guests);
    expect(screen.queryByLabelText(NAME_LABEL)).toBeNull();
  });
});

describe('/k/<код>: the pictures of a result (release 47)', () => {
  const PIC = `11111111-2222-4333-8444-555555555555/${'c'.repeat(64)}.png`;
  const pictured: QuizResult = {
    ...RESULT,
    attempt_id: 'att-0',
    review_now: 'mistakes',
    correct: 0,
    total: 1,
    percent: 0,
    finish_reason: 'sent',
    items: [{ id: 'i2', kind: 'single', stem: 'Какой цвет у неба?', options: ['Зелёный', 'Синий'], code: false, keep_order: false, images: { stem: [PIC], options: [] }, chosen: [0], text: null, right: false, key: null, forms: null }],
  };
  const PAST = [{ attempt_id: 'att-0', n: 1, finished_at: '2026-10-15T12:00:00.000Z', correct: 0, total: 1 }];

  it('a guest’s result: through quiz-media with that attempt and the device’s token', async () => {
    const token = ensureGuestToken(CODE);
    api.previewQuiz.mockResolvedValue({ ...GUEST_PREVIEW, me: { ...GUEST_ME, attempts_used: 1, results: PAST } });
    api.quizResult.mockResolvedValue(pictured);
    renderAt();
    fireEvent.click(await screen.findByRole('button', { name: 'Посмотреть попытку 1' }));
    await waitFor(() => expect(document.querySelector('.ct-pic img')).toHaveAttribute('src', 'blob:guest'));
    expect(api.guestPictureUrl).toHaveBeenCalledWith(PIC, 'att-0', token);
    expect(api.pictureUrl).not.toHaveBeenCalled();
  });

  it('signed in: from the bucket, no token', async () => {
    signedIn({ attempts_used: 1, results: PAST });
    api.quizResult.mockResolvedValue(pictured);
    renderAt();
    fireEvent.click(await screen.findByRole('button', { name: 'Посмотреть попытку 1' }));
    await waitFor(() => expect(document.querySelector('.ct-pic img')).toHaveAttribute('src', 'blob:signed-in'));
    expect(api.pictureUrl).toHaveBeenCalledWith(PIC);
    expect(api.guestPictureUrl).not.toHaveBeenCalled();
  });
});

describe('/k/<код> signed in on a device with attempts written here without an account (a shared computer)', () => {
  const FINISHED = '2026-10-15T12:00:00.000Z';
  const LATER = '2026-10-15T15:30:00.000Z';
  /** What the device's guest sees of the quiz (previewAsGuest): two attempts, the later one last finished. */
  function deviceHas(me: Partial<QuizPreviewMe> = {}) {
    api.previewAsGuest.mockResolvedValue({
      ...GUEST_PREVIEW,
      me: {
        ...GUEST_ME,
        attempts_used: 2,
        can_start: false,
        reason: 'no_attempts',
        results: [
          { attempt_id: 'g-2', n: 2, finished_at: LATER, correct: 3, total: 20 },
          { attempt_id: 'g-1', n: 1, finished_at: FINISHED, correct: 2, total: 20 },
        ],
        ...me,
      },
    });
  }
  const card = () => document.querySelector('.qt-device');
  const LINE = () => `На этом устройстве есть попытка без входа от ${plain(dateTimeText(LATER))}.`;

  it('nothing moves by itself: a card above the start asks whose they are, with the time of the last one', async () => {
    const token = ensureGuestToken(CODE);
    signedIn();
    deviceHas();
    renderAt();
    const field = await screen.findByLabelText(NAME_LABEL);
    expect(api.claimGuestAttempts).not.toHaveBeenCalled();
    // Signed in, the page's own preview goes without the token; the device's attempts are read as its guest reads them.
    expect(api.previewQuiz).toHaveBeenCalledWith(CODE);
    expect(api.previewAsGuest).toHaveBeenCalledWith(CODE, token);
    expect(plain(card()?.querySelector('.qt-device-t')?.textContent)).toBe(LINE());
    expect(within(card() as HTMLElement).getByRole('button', { name: 'Это я — перенести в аккаунт' })).toBeInTheDocument();
    expect(within(card() as HTMLElement).getByRole('button', { name: 'Это не я' })).toBeInTheDocument();
    expect((card()?.compareDocumentPosition(field) ?? 0) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(guestToken(CODE)).toBe(token);
  });

  it('«Это я — перенести в аккаунт»: the claim, then the token goes, the card too, and «me» comes again', async () => {
    const token = ensureGuestToken(CODE);
    signedIn();
    deviceHas();
    api.claimGuestAttempts.mockResolvedValue({ claimed: 2 });
    renderAt();
    fireEvent.click(await screen.findByRole('button', { name: 'Это я — перенести в аккаунт' }));
    await waitFor(() => expect(api.claimGuestAttempts).toHaveBeenCalledWith(CODE, token));
    await waitFor(() => expect(api.previewQuiz).toHaveBeenCalledTimes(2));
    expect(guestToken(CODE)).toBeNull();
    expect(card()).toBeNull();
    expect(api.previewAsGuest).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(page()).not.toContain('не перенесены');
  });

  it('nothing moved (the account writes this quiz itself): said; the token stays, not asked again on this page', async () => {
    const token = ensureGuestToken(CODE);
    signedIn();
    deviceHas();
    api.startQuiz.mockRejectedValue(new ContainerApiError('MC014', 'Попытки закончились.', { status: 400, detail: 'attempts' }));
    renderAt();
    fireEvent.click(await screen.findByRole('button', { name: 'Это я — перенести в аккаунт' }));
    expect(await screen.findByText('Попытки без входа не перенесены: в аккаунте уже есть попытки этой контрольной.')).toBeInTheDocument();
    expect(card()).toBeNull();
    expect(guestToken(CODE)).toBe(token);
    // Another preview (after a refused start) does not bring the card back.
    fireEvent.click(screen.getByRole('button', { name: 'Начать' }));
    await waitFor(() => expect(api.previewQuiz).toHaveBeenCalledTimes(3));
    expect(card()).toBeNull();
    expect(api.previewAsGuest).toHaveBeenCalledTimes(1);
    expect(api.claimGuestAttempts).toHaveBeenCalledTimes(1);
  });

  it('«Это не я»: the token goes, the card too; nothing is claimed', async () => {
    ensureGuestToken(CODE);
    signedIn();
    deviceHas();
    renderAt();
    fireEvent.click(await screen.findByRole('button', { name: 'Это не я' }));
    expect(card()).toBeNull();
    expect(guestToken(CODE)).toBeNull();
    expect(api.claimGuestAttempts).not.toHaveBeenCalled();
    expect(screen.getByLabelText(NAME_LABEL)).toBeInTheDocument();
  });

  it('a failed claim is said; the card stays and can be pressed again', async () => {
    const token = ensureGuestToken(CODE);
    signedIn();
    deviceHas();
    api.claimGuestAttempts.mockRejectedValueOnce(new ContainerApiError('network', 'Нет сети', { status: 0 })).mockResolvedValue({ claimed: 2 });
    renderAt();
    const mine = await screen.findByRole('button', { name: 'Это я — перенести в аккаунт' });
    fireEvent.click(mine);
    expect(await screen.findByRole('alert')).toHaveTextContent('Нет сети');
    expect(card()).not.toBeNull();
    expect(guestToken(CODE)).toBe(token);
    await waitFor(() => expect(mine).not.toBeDisabled());
    fireEvent.click(mine);
    await waitFor(() => expect(guestToken(CODE)).toBeNull());
    expect(api.claimGuestAttempts).toHaveBeenCalledTimes(2);
  });

  it('only an unfinished attempt there: the line without a time', async () => {
    ensureGuestToken(CODE);
    signedIn();
    deviceHas({ attempts_used: 1, open_attempt: 'g-1', can_start: true, reason: null, results: [] });
    renderAt();
    await screen.findByLabelText(NAME_LABEL);
    expect(plain(card()?.querySelector('.qt-device-t')?.textContent)).toBe('На этом устройстве есть начатая попытка без входа.');
  });

  it('no attempts behind the token (a start that did not happen): no card', async () => {
    ensureGuestToken(CODE);
    signedIn();
    deviceHas({ attempts_used: 0, can_start: true, reason: null, results: [] });
    renderAt();
    await screen.findByLabelText(NAME_LABEL);
    expect(api.previewAsGuest).toHaveBeenCalledTimes(1);
    expect(card()).toBeNull();
  });

  it('a quiz that no longer takes guests (its guest «me» is null): no card', async () => {
    ensureGuestToken(CODE);
    signedIn();
    api.previewAsGuest.mockResolvedValue({ ...PREVIEW, guests: false, me: null });
    renderAt();
    await screen.findByLabelText(NAME_LABEL);
    expect(card()).toBeNull();
  });

  it('a failed read of the device’s attempts leaves the card out; the page opens', async () => {
    const token = ensureGuestToken(CODE);
    signedIn();
    api.previewAsGuest.mockRejectedValue(new ContainerApiError('network', 'Нет сети', { status: 0 }));
    renderAt();
    expect(await screen.findByLabelText(NAME_LABEL)).toBeInTheDocument();
    expect(card()).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(guestToken(CODE)).toBe(token);
  });

  it('the quiz’s author: no card', async () => {
    ensureGuestToken(CODE);
    signedIn({ is_author: true });
    deviceHas();
    renderAt();
    await screen.findByText(/Это ваша контрольная/);
    expect(card()).toBeNull();
    expect(api.claimGuestAttempts).not.toHaveBeenCalled();
  });

  it('no token on this device: nothing to ask, nothing read as a guest', async () => {
    signedIn();
    renderAt();
    await screen.findByLabelText(NAME_LABEL);
    expect(api.previewAsGuest).not.toHaveBeenCalled();
    expect(api.claimGuestAttempts).not.toHaveBeenCalled();
    expect(card()).toBeNull();
  });
});

describe('/k/<код> as a guest on a device that holds someone’s attempts: «Я другой человек»', () => {
  it('next to «Продолжить»: the token goes and a fresh start opens with the name field empty', async () => {
    const token = ensureGuestToken(CODE);
    api.previewQuiz.mockImplementation(async (_code: string, held: string | null) =>
      held
        ? { ...GUEST_PREVIEW, me: { ...GUEST_ME, attempts_used: 1, open_attempt: 'att-1', can_start: true } }
        : GUEST_PREVIEW,
    );
    renderAt();
    const resume = await screen.findByRole('button', { name: 'Продолжить' });
    const other = screen.getByRole('button', { name: 'Я другой человек' });
    expect(other).toHaveClass('sf-link');
    expect(other.closest('.qt-actions')).toBe(resume.closest('.qt-actions'));
    fireEvent.click(other);
    const field = await screen.findByLabelText(NAME_LABEL);
    expect(field).toHaveValue('');
    expect(guestToken(CODE)).toBeNull();
    expect(api.previewQuiz).toHaveBeenLastCalledWith(CODE, null);
    expect(screen.queryByRole('button', { name: 'Продолжить' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Я другой человек' })).toBeNull();
    // The new person's start makes a new token.
    fireEvent.change(field, { target: { value: 'Пётр Сидоров' } });
    fireEvent.click(screen.getByRole('button', { name: 'Начать' }));
    await waitFor(() => expect(api.startQuiz).toHaveBeenCalledTimes(1));
    const fresh = api.startQuiz.mock.calls[0][2] as string;
    expect(fresh).toMatch(TOKEN_RE);
    expect(fresh).not.toBe(token);
  });

  it('no attempts left on this device: under the reason, the same way to start over', async () => {
    ensureGuestToken(CODE);
    api.previewQuiz.mockImplementation(async (_code: string, held: string | null) =>
      held
        ? {
            ...GUEST_PREVIEW,
            me: {
              ...GUEST_ME,
              attempts_used: 1,
              can_start: false,
              reason: 'no_attempts',
              results: [{ attempt_id: 'att-0', n: 1, finished_at: '2026-10-15T12:00:00.000Z', correct: 12, total: 20 }],
            },
          }
        : GUEST_PREVIEW,
    );
    renderAt();
    expect(await screen.findByText('Попытки закончились.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Я другой человек' }));
    expect(await screen.findByLabelText(NAME_LABEL)).toHaveValue('');
    expect(guestToken(CODE)).toBeNull();
    expect(page()).not.toContain('Попытка 1 · 12 из 20');
  });

  it('a guest without attempts here, or someone signed in: no such button', async () => {
    api.previewQuiz.mockResolvedValue(GUEST_PREVIEW);
    renderAt();
    await screen.findByLabelText(NAME_LABEL);
    expect(screen.queryByRole('button', { name: 'Я другой человек' })).toBeNull();
    cleanup();
    signedIn({ attempts_used: 1, open_attempt: 'att-1' });
    renderAt();
    await screen.findByRole('button', { name: 'Продолжить' });
    expect(screen.queryByRole('button', { name: 'Я другой человек' })).toBeNull();
  });
});

describe('/k/<код>?practice=1: back from making an account to train (release 47, spec §47.5)', () => {
  it('takes the device’s attempts, joins the exam and opens it', async () => {
    const token = ensureGuestToken(CODE);
    signedIn();
    api.claimGuestAttempts.mockResolvedValue({ claimed: 1 });
    api.joinPractice.mockResolvedValue({ container_id: 'cont-9' });
    renderAt(CODE, '?practice=1');
    await waitFor(() => expect(where).toBe('/exams/c/cont-9'));
    expect(api.claimGuestAttempts).toHaveBeenCalledWith(CODE, token);
    expect(api.joinPractice).toHaveBeenCalledWith(CODE);
    expect(api.claimGuestAttempts.mock.invocationCallOrder[0]).toBeLessThan(api.joinPractice.mock.invocationCallOrder[0]);
    expect(api.previewQuiz).not.toHaveBeenCalled();
  });

  it.each([
    ['practice', QUIZ_ERRORS.MC018_practice],
    // a quiz of the exam opened since the result said «ready» (20261018130000_quiz_guards)
    ['open', QUIZ_ERRORS.MC018_open],
  ] as const)('a refusal (MC018 %s) is said on the page, which opens as usual', async (detail, words) => {
    signedIn();
    api.joinPractice.mockRejectedValue(new ContainerApiError('MC018', words, { status: 400, detail }));
    renderAt(CODE, '?practice=1');
    expect(await screen.findByLabelText(NAME_LABEL)).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(words);
    expect(where).toBe('');
    expect(api.joinPractice).toHaveBeenCalledTimes(1);
  });

  it('the claim of the way back runs once even when the join is refused; no card asks again', async () => {
    const token = ensureGuestToken(CODE);
    signedIn();
    api.claimGuestAttempts.mockResolvedValue({ claimed: 1 });
    api.joinPractice.mockRejectedValue(new ContainerApiError('MC018', QUIZ_ERRORS.MC018_open, { status: 400, detail: 'open' }));
    renderAt(CODE, '?practice=1');
    expect(await screen.findByLabelText(NAME_LABEL)).toBeInTheDocument();
    expect(api.claimGuestAttempts).toHaveBeenCalledTimes(1);
    expect(api.claimGuestAttempts).toHaveBeenCalledWith(CODE, token);
    expect(guestToken(CODE)).toBeNull();
    expect(document.querySelector('.qt-device')).toBeNull();
  });

  it('still signed out: nothing is joined', async () => {
    api.previewQuiz.mockResolvedValue(GUEST_PREVIEW);
    renderAt(CODE, '?practice=1');
    await screen.findByLabelText(NAME_LABEL);
    expect(api.joinPractice).not.toHaveBeenCalled();
    expect(api.claimGuestAttempts).not.toHaveBeenCalled();
  });

  it('a signed-in member gets «Открыть экзамен» on the result', async () => {
    signedIn({ attempts_used: 1, results: [{ attempt_id: 'att-0', n: 1, finished_at: '2026-10-15T12:00:00.000Z', correct: 12, total: 20 }] });
    api.quizResult.mockResolvedValue({ ...RESULT, attempt_id: 'att-0', practice: { exam_title: 'Зимняя сессия', member: true } });
    api.joinPractice.mockResolvedValue({ container_id: 'cont-3' });
    renderAt();
    fireEvent.click(await screen.findByRole('button', { name: 'Посмотреть попытку 1' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Открыть экзамен' }));
    await waitFor(() => expect(where).toBe('/exams/c/cont-3'));
    expect(api.joinPractice).toHaveBeenCalledWith(CODE);
  });
});

describe('/k/<код>: the cover and the colour (release 47, spec §47.4)', () => {
  it('the colour on the page’s root, the cover on top of the card (decorative)', async () => {
    api.previewQuiz.mockResolvedValue({ ...PREVIEW, accent: 'violet', cover_path: 'c1/cover.png' });
    renderAt();
    const title = await screen.findByRole('heading', { level: 1, name: 'Контрольная по базам данных' });
    expect(document.querySelector('.qt')).toHaveAttribute('data-accent', 'violet');
    const cover = document.querySelector('.qt-cover img')!;
    expect(cover).toHaveAttribute('src', 'https://covers.test/c1/cover.png');
    expect(cover).toHaveAttribute('alt', '');
    expect(cover.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('no cover and a colour it does not know: Meldy’s blue, no picture', async () => {
    api.previewQuiz.mockResolvedValue({ ...PREVIEW, accent: 'teal' as never, cover_path: null });
    renderAt();
    await screen.findByRole('heading', { level: 1, name: 'Контрольная по базам данных' });
    expect(document.querySelector('.qt')).toHaveAttribute('data-accent', 'blue');
    expect(document.querySelector('.qt-cover')).toBeNull();
  });

  it('a cover that does not load goes away', async () => {
    api.previewQuiz.mockResolvedValue({ ...PREVIEW, cover_path: 'c1/cover.png' });
    renderAt();
    await screen.findByRole('heading', { level: 1, name: 'Контрольная по базам данных' });
    fireEvent.error(document.querySelector('.qt-cover img')!);
    expect(document.querySelector('.qt-cover')).toBeNull();
  });

  it('the attempt keeps the quiz’s colour; the result takes the one it brings', async () => {
    signedIn({ attempts_used: 1, results: [{ attempt_id: 'att-0', n: 1, finished_at: '2026-10-15T12:00:00.000Z', correct: 12, total: 20 }] }, { accent: 'green', attempts: 2 });
    api.quizResult.mockResolvedValue({ ...RESULT, attempt_id: 'att-0', accent: 'pink' });
    renderAt();
    fireEvent.click(await screen.findByRole('button', { name: 'Посмотреть попытку 1' }));
    await waitFor(() => expect(document.querySelector('.ct-roomshell')).toHaveAttribute('data-accent', 'pink'));
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Начать' }));
    await waitFor(() => expect(options().length).toBe(3));
    expect(document.querySelector('.ct-roomshell')).toHaveAttribute('data-accent', 'green');
    expect(document.querySelector('.qt-time')).not.toBeNull();
  });
});

describe('/k/<код>: the start in view (release 47 design fixes)', () => {
  it('no «Контрольная» above the title; the facts keep their date whole; the name says who sees it', async () => {
    signedIn({}, { pass_percent: 60 });
    renderAt();
    const title = await screen.findByRole('heading', { level: 1, name: 'Контрольная по базам данных' });
    // Nothing between the top of the card and the title but the cover.
    expect(title.previousElementSibling).toBeNull();
    expect(document.querySelector('.qt-kicker')).toBeNull();
    const meta = document.querySelector('.qt-meta')!;
    // «24 окт., 18:00» never splits: the spaces inside the date and the time are non-breaking.
    expect(meta.textContent).toContain(`открыта до${NB}24${NB}окт.,${NB}18:00`);
    const field = screen.getByLabelText(NAME_LABEL);
    expect(labelOf(field)).toBe('Имя и фамилия — их увидит Анна Петрова');
    expect(screen.getByText('Например: Иванов Иван, 9 Б')).toHaveClass('qt-hint');
    // The rules (the pass mark in the result's words) and what the author sees: under «Начать».
    const start = screen.getByRole('button', { name: 'Начать' });
    const rules = document.querySelector('.qt-facts')!;
    expect(start.compareDocumentPosition(rules) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(plain(rules.textContent)).toContain('Проходной балл 60 %.');
    expect(plain(rules.textContent)).toContain('Автор увидит имя, которое вы укажете, ваши ответы и результат.');
  });

  it('without the author’s name the label names «автор теста»', async () => {
    signedIn({}, { author_name: undefined });
    renderAt();
    expect(labelOf(await screen.findByLabelText(NAME_LABEL))).toBe('Имя и фамилия — их увидит автор теста');
  });

  it('a guest: the same label, the browser line under the button', async () => {
    api.previewQuiz.mockResolvedValue(GUEST_PREVIEW);
    renderAt();
    const field = await screen.findByLabelText(NAME_LABEL);
    expect(field).toHaveAccessibleDescription(/^Например: Иванов Иван, 9\sБ$/);
    const start = screen.getByRole('button', { name: 'Начать' });
    expect(start.compareDocumentPosition(screen.getByText(GUEST_PRIVACY)) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('the author on their own page: the label is just «Имя и фамилия», nobody else to see it (release 47.1)', async () => {
    signedIn({ is_author: true });
    renderAt();
    const field = await screen.findByLabelText('Имя и фамилия');
    expect(labelOf(field)).toBe('Имя и фамилия');
    expect(page()).not.toContain('их увидит');
  });
});

describe('/k/<код>: the line under the title without a repeated name (release 47.1)', () => {
  const byLine = () => plain(document.querySelector('.qt-by')?.textContent);

  it('the exam left out when its title is the quiz’s own, whatever the case and the spaces', async () => {
    api.previewQuiz.mockResolvedValue({ ...PREVIEW, title: 'Проверка  выпуска 47', exam_title: ' проверка выпуска 47 ' });
    renderAt();
    await screen.findByRole('heading', { level: 1 });
    expect(byLine()).toBe('автор: Анна Петрова');
    expect(page()).not.toContain('экзамен «');
  });

  it('another title: «автор: … · экзамен «…»» as before', async () => {
    renderAt();
    await screen.findByRole('heading', { level: 1 });
    expect(byLine()).toBe('автор: Анна Петрова · экзамен «Зимняя сессия»');
  });

  it('without the author’s name the exam alone, and nothing when it repeats the title', async () => {
    api.previewQuiz.mockResolvedValue({ ...PREVIEW, author_name: undefined });
    renderAt();
    await screen.findByRole('heading', { level: 1 });
    expect(byLine()).toBe('экзамен «Зимняя сессия»');
    cleanup();
    api.previewQuiz.mockResolvedValue({ ...PREVIEW, author_name: undefined, exam_title: 'КОНТРОЛЬНАЯ ПО БАЗАМ ДАННЫХ' });
    renderAt();
    await screen.findByRole('heading', { level: 1 });
    expect(document.querySelector('.qt-by')).toBeNull();
  });
});

describe('/k/<код>: a quiz «как в студии» (release 47.2)', () => {
  const COVER = `11111111-2222-4333-8444-555555555555/${'a'.repeat(64)}.jpg`;
  const design = (withCover = true): DocDesign => ({
    title: 'Кислоты',
    theme: { accent: { custom: '#3fb68b' }, background: { kind: 'soft', tone: 'green' }, font: 'serif', radius: 'round', density: 'airy', answers: 'list', buttons: 'rounded' },
    layout: 'one_page',
    blocks: [
      ...(withCover ? [{ type: 'cover' as const, id: 'cover0000001', title: 'Кислоты и основания', subtitle: 'Проверочная работа, 8 класс', image: COVER, align: 'left' as const }] : []),
      { type: 'question', id: 'quest0000001', item_id: 'i1', points: 2, required: false },
      { type: 'question', id: 'quest0000002', item_id: 'i2', points: 1, required: false },
      { type: 'question', id: 'quest0000003', item_id: 'i3', points: 3, required: false },
    ],
    results: { bands: [], cta: null },
  });

  it('the start is the page’s cover — its title, its line and its picture — in the page’s colours, not the quiz’s', async () => {
    signedIn({}, { accent: 'violet', cover_path: 'c1/cover.png', design: design() });
    renderAt();
    const title = await screen.findByRole('heading', { level: 1, name: 'Кислоты и основания' });
    expect(screen.getByText('Проверочная работа, 8 класс')).toBeInTheDocument();
    expect(document.querySelector('.qt-cover img')).toHaveAttribute('src', `https://covers.test/${COVER}`);
    const root = document.querySelector('.qt') as HTMLElement;
    expect(root).toHaveAttribute('data-design', '');
    expect(root).toHaveAttribute('data-bg', 'soft');
    // The custom colour, nudged for white text, on the root; the quiz's violet gives way.
    expect(root.style.getPropertyValue('--qt-fill')).toMatch(/^#[0-9a-f]{6}$/);
    expect(root.style.getPropertyValue('--qt-fill')).not.toBe('#3fb68b');
    expect(root).toHaveAttribute('data-accent', 'blue');
    expect(root.style.getPropertyValue('--doc-font')).toContain('Georgia');
    expect(title.compareDocumentPosition(screen.getByRole('button', { name: 'Начать' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('a page without a cover: the quiz’s title, no picture at all (the quiz’s cover gives way too)', async () => {
    signedIn({}, { cover_path: 'c1/cover.png', design: design(false) });
    renderAt();
    await screen.findByRole('heading', { level: 1, name: 'Контрольная по базам данных' });
    expect(document.querySelector('.qt-cover')).toBeNull();
    expect(document.querySelector('.qt')).toHaveAttribute('data-design', '');
  });

  it('«Начать» opens the page in its theme; the result keeps the theme; earlier results say the points', async () => {
    signedIn({ attempts_used: 1, results: [{ attempt_id: 'att-0', n: 1, finished_at: '2026-10-15T12:00:00.000Z', correct: 2, total: 3, score: 5, max_score: 6 }] }, { attempts: 2, design: design() });
    api.startQuiz.mockResolvedValue({ ...ATTEMPT, design: design() });
    api.quizResult.mockResolvedValue({ ...RESULT, attempt_id: 'att-0', correct: 2, total: 3, score: 5, max_score: 6, percent: 83, design: design(), band: null });
    renderAt();
    expect(await screen.findByRole('heading', { name: 'Ваши попытки' })).toBeInTheDocument();
    expect(page()).toContain('Попытка 1 · 5 баллов из 6');
    fireEvent.click(screen.getByRole('button', { name: 'Посмотреть попытку 1' }));
    await waitFor(() => expect(plain(document.querySelector('.qt-score')?.textContent)).toBe('5 баллов из 6 · 83 %'));
    expect(document.querySelector('.ct-roomshell')).toHaveAttribute('data-design', '');
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Начать' }));
    await waitFor(() => expect(document.querySelector('.dv')).not.toBeNull());
    const shell = document.querySelector('.ct-roomshell') as HTMLElement;
    expect(shell).toHaveAttribute('data-design', '');
    expect(shell.style.getPropertyValue('--doc-radius-button')).toBe('14px');
    expect(bar()).toBe('Отвечено 0 из 3 · осталось 30:00');
    expect(screen.getByRole('heading', { name: 'Кислоты и основания' })).toBeInTheDocument();
    expect(screen.getAllByRole('region')).toHaveLength(3);
  });

  it('the author’s own picture as the background: behind the start, the attempt and the result; a video plays in the attempt', async () => {
    const OWN = `11111111-2222-4333-8444-555555555555/${'c'.repeat(64)}.webp`;
    const withPicture = (): DocDesign => {
      const page = design();
      return {
        ...page,
        theme: { ...page.theme, background: { kind: 'image', path: OWN, dim: 35 } },
        blocks: [page.blocks[0], { type: 'video', id: 'video0000001', url: 'https://youtu.be/dQw4w9WgXcQ', caption: 'Опыт' }, ...page.blocks.slice(1)],
      };
    };
    signedIn({ attempts_used: 1, results: [{ attempt_id: 'att-0', n: 1, finished_at: '2026-10-15T12:00:00.000Z', correct: 2, total: 3, score: 5, max_score: 6 }] }, { attempts: 2, design: withPicture() });
    api.startQuiz.mockResolvedValue({ ...ATTEMPT, design: withPicture() });
    api.quizResult.mockResolvedValue({ ...RESULT, attempt_id: 'att-0', correct: 2, total: 3, score: 5, max_score: 6, percent: 83, design: withPicture(), band: null });
    renderAt();
    await screen.findByRole('heading', { name: 'Ваши попытки' });
    expect(document.querySelector('.qt')).toHaveAttribute('data-bg', 'image');
    expect(document.querySelector('.qt > .qt-bg img')).toHaveAttribute('src', `https://covers.test/${OWN}`);
    // The result: the picture behind, the result on the page's surface.
    fireEvent.click(screen.getByRole('button', { name: 'Посмотреть попытку 1' }));
    await waitFor(() => expect(document.querySelector('.qt-score')).not.toBeNull());
    expect(document.querySelector('.ct-roomshell')).toHaveAttribute('data-bg', 'image');
    expect(document.querySelector('.ct-roomshell > .qt-bg img')).toHaveAttribute('src', `https://covers.test/${OWN}`);
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }));
    // The attempt: the page draws the picture itself, and the video's player.
    fireEvent.click(await screen.findByRole('button', { name: 'Начать' }));
    await waitFor(() => expect(document.querySelector('.dv')).not.toBeNull());
    expect(document.querySelector('.dv-bg img')).toHaveAttribute('src', `https://covers.test/${OWN}`);
    expect(document.querySelector('.ct-roomshell > .qt-bg')).toBeNull();
    expect(screen.getByTitle('Опыт')).toHaveAttribute('src', 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
  });
});
