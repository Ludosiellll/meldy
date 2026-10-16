import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { QuizAttempt, QuizAttemptItem, QuizPreview, QuizPreviewMe, QuizResult } from '../../types/quiz';

const api = vi.hoisted(() => ({
  previewQuiz: vi.fn(),
  startQuiz: vi.fn(),
  sendAnswers: vi.fn(),
  finishQuiz: vi.fn(),
  quizResult: vi.fn(),
  track: vi.fn(),
  auth: { user: null as null | { id: string }, loading: false },
}));
vi.mock('../../api/quizzes', () => ({
  previewQuiz: api.previewQuiz,
  startQuiz: api.startQuiz,
  sendAnswers: api.sendAnswers,
  finishQuiz: api.finishQuiz,
  quizResult: api.quizResult,
}));
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: api.auth.user, loading: api.auth.loading, requestSession: vi.fn() }) }));
vi.mock('../../lib/supabase', () => ({ supabase: { rpc: vi.fn(), auth: { signInWithOAuth: vi.fn() }, storage: { from: vi.fn() } } }));
vi.mock('../../lib/telemetry', () => ({ track: api.track }));

import QuizTakePage from './QuizTakePage';
import { ContainerApiError } from '../../api/containers';
import { storeKey } from '../../components/quiz/QuizRun';

const NB = String.fromCharCode(0xa0);
const plain = (text: string | null | undefined) => (text ?? '').split(NB).join(' ');
const page = () => plain(document.body.textContent);
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

function renderAt(code = CODE) {
  return render(
    <MemoryRouter initialEntries={[`/k/${code}`]}>
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
  where = '';
  api.auth.user = null;
  api.auth.loading = false;
  api.previewQuiz.mockReset().mockResolvedValue(PREVIEW);
  api.startQuiz.mockReset().mockResolvedValue(ATTEMPT);
  api.sendAnswers.mockReset().mockResolvedValue({ saved: 1, server_now: SERVER_NOW, deadline_at: ATTEMPT.deadline_at });
  api.finishQuiz.mockReset().mockResolvedValue(RESULT);
  api.quizResult.mockReset().mockResolvedValue(RESULT);
  api.track.mockReset();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('/k/<код> before the start (spec §2.2)', () => {
  it('signed out: what it is, who sees what, and sign-in that comes back here', async () => {
    renderAt();
    expect(await screen.findByRole('heading', { level: 1, name: 'Контрольная по базам данных' })).toBeInTheDocument();
    expect(api.previewQuiz).toHaveBeenCalledWith(CODE);
    expect(page()).toContain('автор: Анна Петрова');
    expect(page()).toContain('экзамен «Зимняя сессия»');
    expect(page()).toContain('20 вопросов · 30 минут · открыта до 24 окт., 18:00 · 1 попытка');
    expect(page()).toContain('К вопросам можно возвращаться');
    const privacy = screen.getByText('Автор увидит имя, которое вы укажете, ваши ответы и результат.');
    const signIn = screen.getByRole('link', { name: 'Войти, чтобы начать' });
    expect(signIn).toHaveAttribute('href', `/login?next=${encodeURIComponent(`/k/${CODE}`)}`);
    expect(signIn).toHaveClass('sf-primary');
    // The line about the author comes before anything that can be pressed.
    expect(privacy.compareDocumentPosition(signIn) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Начать' })).toBeNull();
    expect(screen.queryByLabelText('Ваше имя для автора')).toBeNull();
    fireEvent.click(signIn);
    expect(where).toBe(`/login?next=${encodeURIComponent(`/k/${CODE}`)}`);
  });

  it('no timer, attempts without limit, only forward, a pass mark', async () => {
    api.previewQuiz.mockResolvedValue({ ...PREVIEW, time_limit_s: null, attempts: null, allow_back: false, pass_percent: 60, closes_at: null });
    renderAt();
    await screen.findByRole('heading', { level: 1, name: 'Контрольная по базам данных' });
    expect(page()).toContain('20 вопросов · без ограничения времени · попыток сколько угодно');
    expect(page()).toContain('Только вперёд: к прошлым вопросам вернуться нельзя.');
    expect(page()).toContain('Проходной балл — 60 %.');
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
    const field = await screen.findByLabelText('Ваше имя для автора');
    expect(field).toHaveValue('Иван Иванов');
    expect(screen.getByText('Автор увидит имя, которое вы укажете, ваши ответы и результат.').compareDocumentPosition(field) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.change(field, { target: { value: '  Иванов Иван, гр. 21 ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Начать' }));
    await waitFor(() => expect(api.startQuiz).toHaveBeenCalledWith(CODE, 'Иванов Иван, гр. 21'));
    // The attempt: the clock from the server's deadline (the device is two minutes ahead).
    await waitFor(() => expect(bar()).toBe('Контрольная · 1 из 3 · 30:00'));
    expect(api.track).toHaveBeenCalledWith('quiz.started', { resumed: false });
  });

  it('a name shorter than 2 characters is not sent', async () => {
    signedIn({ name_hint: '' });
    renderAt();
    fireEvent.change(await screen.findByLabelText('Ваше имя для автора'), { target: { value: ' И ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Начать' }));
    expect(await screen.findByText('Имя — от 2 до 80 знаков.')).toBeInTheDocument();
    expect(screen.getByLabelText('Ваше имя для автора')).toHaveAttribute('aria-invalid', 'true');
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
    expect(screen.queryByLabelText('Ваше имя для автора')).toBeNull();
  });

  it('a profile without a name leaves the field empty', async () => {
    signedIn({ name_hint: null });
    renderAt();
    expect(await screen.findByLabelText('Ваше имя для автора')).toHaveValue('');
  });

  it('a quiz deleted since the preview (P0002) is said as a link that does not work', async () => {
    signedIn();
    api.startQuiz.mockRejectedValue(new ContainerApiError('P0002', 'Не найдено', { status: 400 }));
    renderAt();
    await screen.findByLabelText('Ваше имя для автора');
    fireEvent.click(screen.getByRole('button', { name: 'Начать' }));
    expect(await screen.findByText('Такой контрольной нет. Проверьте ссылку.')).toBeInTheDocument();
  });

  it('a session that ended on the way leads to sign-in, back here', async () => {
    signedIn();
    api.startQuiz.mockRejectedValue(new ContainerApiError('42501', 'Нет доступа', { status: 401 }));
    renderAt();
    await screen.findByLabelText('Ваше имя для автора');
    fireEvent.click(screen.getByRole('button', { name: 'Начать' }));
    expect(await screen.findByText(/Вход закончился/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Войти' })).toHaveAttribute('href', `/login?next=${encodeURIComponent(`/k/${CODE}`)}`);
  });

  it('a refusal of the start is said in words', async () => {
    signedIn();
    api.startQuiz.mockRejectedValue(new ContainerApiError('MC014', 'Попытки закончились.', { status: 400, detail: 'attempts' }));
    renderAt();
    await screen.findByLabelText('Ваше имя для автора');
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
    await waitFor(() => expect(api.quizResult).toHaveBeenCalledWith('att-0'));
    await waitFor(() => expect(plain(document.querySelector('.qt-score')?.textContent)).toBe('12 из 20 · 60 %'));
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }));
    expect(await screen.findByLabelText('Ваше имя для автора')).toBeInTheDocument();
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
    expect(screen.queryByLabelText('Ваше имя для автора')).toBeNull();
    fireEvent.click(resume);
    await waitFor(() => expect(api.startQuiz).toHaveBeenCalledWith(CODE, 'Иван Иванов'));
    // The first question without an answer is the third; 20 minutes are left, not 30.
    await waitFor(() => expect(bar()).toBe('Контрольная · 3 из 3 · 20:00'));
    expect(api.track).toHaveBeenCalledWith('quiz.started', { resumed: true });
    await waitFor(() => expect(api.sendAnswers).toHaveBeenCalledWith('att-1', [{ item_id: 'i2', chosen: [1] }]));
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
    await screen.findByLabelText('Ваше имя для автора');
    fireEvent.click(screen.getByRole('button', { name: 'Начать' }));
    await waitFor(() => expect(options().length).toBe(3));
    fireEvent.click(options()[1]);
    await waitFor(() => expect(api.quizResult).toHaveBeenCalledWith('att-1'), { timeout: 2000 });
    await waitFor(() => expect(plain(document.querySelector('.qt-score')?.textContent)).toBe('1 из 3 · 33 %'));
    expect(page()).toContain('Время вышло — попытка закрылась сама.');
  });

  it('the time runs out: the attempt finishes by itself; «Ещё попытка» goes back to the start', async () => {
    signedIn({ attempts_used: 0 }, { attempts: 2 });
    renderAt();
    await screen.findByLabelText('Ваше имя для автора');
    fireEvent.click(screen.getByRole('button', { name: 'Начать' }));
    await waitFor(() => expect(bar()).toBe('Контрольная · 1 из 3 · 30:00'));
    await act(async () => {
      vi.setSystemTime(Date.parse('2026-10-16T10:32:00.000Z'));
    });
    await waitFor(() => expect(api.finishQuiz).toHaveBeenCalledWith('att-1'), { timeout: 3000 });
    const retry = await screen.findByRole('button', { name: (name) => plain(name) === 'Ещё попытка (осталась 1)' });
    fireEvent.click(retry);
    expect(await screen.findByLabelText('Ваше имя для автора')).toBeInTheDocument();
    await waitFor(() => expect(api.previewQuiz).toHaveBeenCalledTimes(2));
  });
});
