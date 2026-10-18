import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { QuizAccent, QuizAttempt, QuizAttemptItem, QuizResult } from '../../types/quiz';

const api = vi.hoisted(() => ({
  sendAnswers: vi.fn(),
  finishQuiz: vi.fn(),
  quizResult: vi.fn(),
  track: vi.fn(),
}));
vi.mock('../../api/quizzes', () => ({ sendAnswers: api.sendAnswers, finishQuiz: api.finishQuiz, quizResult: api.quizResult }));
vi.mock('../../lib/telemetry', () => ({ track: api.track }));
vi.mock('../../lib/supabase', () => ({ supabase: { rpc: vi.fn(), storage: { from: vi.fn() } } }));
const pictures = vi.hoisted(() => ({ pictureUrl: vi.fn(), guestPictureUrl: vi.fn() }));
vi.mock('../../api/itemPictures', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/itemPictures')>()),
  pictureUrl: pictures.pictureUrl,
  guestPictureUrl: pictures.guestPictureUrl,
}));

import QuizRun, { RETRY_MS, SEND_DELAY_MS, storeKey } from './QuizRun';
import { ContainerApiError } from '../../api/containers';
import { optionOrder, pinnedLast } from '../../lib/containers/session';

const NB = String.fromCharCode(0xa0);
const plain = (text: string | null | undefined) => (text ?? '').split(NB).join(' ');
const bar = () => plain(screen.getByRole('banner').querySelector('.ct-rb-long')?.textContent);
const options = () => Array.from(document.querySelectorAll<HTMLButtonElement>('.ct-opts .ct-opt'));
const optionTexts = () => options().map((button) => button.querySelector('.ct-opt-t')?.textContent ?? '');
const stored = () => window.localStorage.getItem(storeKey('att-1'));

const ITEMS: QuizAttemptItem[] = [
  { id: 'i1', kind: 'single', stem: 'Сколько будет 2 + 2?', options: ['3', '4', '5', '6'], code: false, keep_order: false, images: null },
  { id: 'i2', kind: 'multiple', stem: 'Выберите чётные числа', options: ['1', '2', '4'], code: false, keep_order: false, images: null },
  { id: 'i3', kind: 'short', stem: 'Столица Франции', options: [], code: false, keep_order: false, images: null },
];

/** The server's clock is 10:00; the device's is two minutes ahead (10:02). */
const SERVER_NOW = '2026-10-16T10:00:00.000Z';
const DEVICE_NOW = Date.parse('2026-10-16T10:02:00.000Z');

function attempt(over: Partial<QuizAttempt> = {}): QuizAttempt {
  return {
    attempt_id: 'att-1',
    n: 1,
    quiz_title: 'Контрольная · 16.10',
    server_now: SERVER_NOW,
    started_at: SERVER_NOW,
    deadline_at: '2026-10-16T10:30:00.000Z',
    allow_back: true,
    shuffle_options: false,
    items: ITEMS,
    answers: [],
    ...over,
  };
}

const RESULT: QuizResult = {
  attempt_id: 'att-1',
  n: 1,
  quiz_title: 'Контрольная · 16.10',
  code: 'abcd2fghjkmn',
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
  attempts_left: 0,
  can_retry: false,
  items: [],
};

/** quiz_answer's answer: the server's clock (two minutes behind the device's) and the deadline as it is now. */
const saved = (deadline: string | null = '2026-10-16T10:30:00.000Z') => ({ saved: 1, server_now: new Date(Date.now() - 120_000).toISOString(), deadline_at: deadline });
const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

let onResult: Mock<(result: QuizResult) => void>;
let onLost: Mock<(message: string) => void>;

function renderRun(value: QuizAttempt = attempt(), token: string | null = null, accent?: QuizAccent) {
  return render(<QuizRun attempt={value} token={token} accent={accent} onResult={onResult} onLost={onLost} />);
}

/** A device's token of a guest (43 characters of base64url). */
const TOKEN = 'A'.repeat(42) + 'g';

beforeEach(() => {
  vi.useFakeTimers({ now: DEVICE_NOW });
  window.localStorage.clear();
  onResult = vi.fn<(result: QuizResult) => void>();
  onLost = vi.fn<(message: string) => void>();
  api.sendAnswers.mockReset().mockImplementation(async () => saved());
  api.finishQuiz.mockReset().mockResolvedValue({ ...RESULT, finish_reason: 'sent' });
  api.quizResult.mockReset().mockResolvedValue(RESULT);
  api.track.mockReset();
  pictures.pictureUrl.mockReset().mockResolvedValue('blob:signed-in');
  pictures.guestPictureUrl.mockReset().mockResolvedValue('blob:guest');
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('QuizRun: the clock', () => {
  it('counts to the server deadline, corrected by the difference of the clocks', async () => {
    renderRun();
    // The device is 2 minutes ahead: without the correction the bar would say 28:00.
    expect(bar()).toBe('1 из 3 · осталось 30:00');
    expect(plain(screen.getByRole('banner').querySelector('.ct-rb-short')?.textContent)).toBe('1 из 3 · осталось 30:00');
    await advance(1000);
    expect(bar()).toBe('1 из 3 · осталось 29:59');
  });

  it('follows the deadline each save brings back (the author moved the closing)', async () => {
    api.sendAnswers.mockImplementation(async () => saved('2026-10-16T10:10:00.000Z'));
    renderRun();
    fireEvent.click(options()[0]);
    await advance(SEND_DELAY_MS);
    expect(bar()).toBe('1 из 3 · осталось 10:00');
  });

  it('corrects the clock by the server time each save brings back', async () => {
    // The device's clock jumps 5 minutes ahead (set by hand); the next save tells the difference again.
    renderRun();
    vi.setSystemTime(DEVICE_NOW + 5 * 60_000);
    api.sendAnswers.mockImplementation(async () => ({ saved: 1, server_now: '2026-10-16T10:00:01.000Z', deadline_at: '2026-10-16T10:30:00.000Z' }));
    fireEvent.click(options()[0]);
    await advance(SEND_DELAY_MS);
    expect(bar()).toBe('1 из 3 · осталось 29:59');
  });

  it('without a time limit shows no clock', () => {
    renderRun(attempt({ deadline_at: null }));
    expect(bar()).toBe('1 из 3');
  });
});

describe('QuizRun: saving the answers', () => {
  it('sends after 500 ms of quiet, the changes of that time in one call, keeping a copy on the device until saved', async () => {
    renderRun();
    fireEvent.click(options()[1]);
    expect(options()[1]).toHaveAttribute('aria-pressed', 'true');
    expect(JSON.parse(stored() ?? '{}')).toEqual({ i1: [1] });
    await advance(SEND_DELAY_MS - 200);
    expect(api.sendAnswers).not.toHaveBeenCalled();
    // The next question within the half second: one call for both.
    fireEvent.click(screen.getByRole('button', { name: 'Дальше' }));
    fireEvent.click(options()[2]);
    fireEvent.click(options()[1]);
    await advance(SEND_DELAY_MS - 1);
    expect(api.sendAnswers).not.toHaveBeenCalled();
    await advance(1);
    expect(api.sendAnswers).toHaveBeenCalledTimes(1);
    expect(api.sendAnswers).toHaveBeenCalledWith('att-1', [
      { item_id: 'i1', chosen: [1] },
      { item_id: 'i2', chosen: [1, 2] },
    ], null);
    expect(stored()).toBeNull();
    expect(screen.getByText('Сохранено')).toBeInTheDocument();
  });

  it('a short answer is sent as text; taking a choice back sends an empty one', async () => {
    renderRun(attempt({ items: [ITEMS[2], ITEMS[0]] }));
    fireEvent.change(screen.getByLabelText('Ваш ответ'), { target: { value: ' Париж ' } });
    await advance(SEND_DELAY_MS);
    expect(api.sendAnswers).toHaveBeenLastCalledWith('att-1', [{ item_id: 'i3', text: 'Париж' }], null);
    fireEvent.click(screen.getByRole('button', { name: 'Дальше' }));
    fireEvent.click(options()[0]);
    fireEvent.click(options()[0]);
    await advance(SEND_DELAY_MS);
    expect(api.sendAnswers).toHaveBeenLastCalledWith('att-1', [{ item_id: 'i1', chosen: [] }], null);
  });

  it('a failed send says so quietly, keeps the copy and is tried again later', async () => {
    api.sendAnswers.mockRejectedValueOnce(new ContainerApiError('network', 'Нет сети', { status: 0 }));
    renderRun();
    fireEvent.click(options()[0]);
    await advance(SEND_DELAY_MS);
    expect(api.sendAnswers).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Нет связи — ответы сохранятся, когда она вернётся')).toBeInTheDocument();
    expect(JSON.parse(stored() ?? '{}')).toEqual({ i1: [0] });
    await advance(RETRY_MS[0]);
    expect(api.sendAnswers).toHaveBeenCalledTimes(2);
    expect(api.sendAnswers).toHaveBeenLastCalledWith('att-1', [{ item_id: 'i1', chosen: [0] }], null);
    expect(stored()).toBeNull();
    expect(screen.getByText('Сохранено')).toBeInTheDocument();
  });

  it('when the network comes back the waiting answers go at once', async () => {
    api.sendAnswers.mockRejectedValue(new ContainerApiError('network', 'Нет сети', { status: 0 }));
    renderRun();
    fireEvent.click(options()[3]);
    await advance(SEND_DELAY_MS);
    await advance(RETRY_MS[0]);
    expect(api.sendAnswers).toHaveBeenCalledTimes(2);
    api.sendAnswers.mockImplementation(async () => saved());
    await act(async () => {
      window.dispatchEvent(new Event('online'));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(api.sendAnswers).toHaveBeenCalledTimes(3);
    expect(stored()).toBeNull();
  });

  it('a change made while a send is on its way is sent after it, not lost', async () => {
    let release: (value: unknown) => void = () => undefined;
    api.sendAnswers.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));
    renderRun();
    fireEvent.click(options()[0]);
    await advance(SEND_DELAY_MS);
    fireEvent.click(options()[2]);
    await act(async () => {
      release(saved());
      await vi.advanceTimersByTimeAsync(0);
    });
    // The first call saved [0]; [2] is newer and still waits.
    expect(JSON.parse(stored() ?? '{}')).toEqual({ i1: [2] });
    await advance(SEND_DELAY_MS);
    expect(api.sendAnswers).toHaveBeenLastCalledWith('att-1', [{ item_id: 'i1', chosen: [2] }], null);
    expect(stored()).toBeNull();
  });
});

describe('QuizRun: the questions', () => {
  it('shuffles the options per attempt and question, and sends the file indices', async () => {
    renderRun(attempt({ shuffle_options: true }));
    const order = optionOrder(4, false, pinnedLast(ITEMS[0].options), 'att-1:i1');
    expect(optionTexts()).toEqual(order.map((index) => ITEMS[0].options[index]));
    fireEvent.click(options()[0]);
    await advance(SEND_DELAY_MS);
    expect(api.sendAnswers).toHaveBeenCalledWith('att-1', [{ item_id: 'i1', chosen: [order[0]] }], null);
  });

  it('keeps the file order when the author asked for it', () => {
    renderRun(attempt({ shuffle_options: false }));
    expect(optionTexts()).toEqual(['3', '4', '5', '6']);
  });

  it('with going back allowed: «Назад» and «Все вопросы»', () => {
    renderRun();
    expect(screen.getByRole('button', { name: 'Назад' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Все вопросы' }));
    const sheet = screen.getByRole('dialog', { name: 'Все вопросы' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Вопрос 3, без ответа' }));
    expect(bar()).toContain('3 из 3');
  });

  it('only forward: neither «Назад» nor «Все вопросы», and no way back', () => {
    renderRun(attempt({ allow_back: false }));
    expect(screen.queryByRole('button', { name: 'Назад' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Все вопросы' })).toBeNull();
    expect(screen.getByText('Только вперёд: к прошлым вопросам не вернуться.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Дальше' }));
    expect(bar()).toContain('2 из 3');
    expect(screen.queryByRole('button', { name: 'Назад' })).toBeNull();
  });

  it('«Завершить» asks first, names the questions without an answer, then shows the result', async () => {
    renderRun();
    fireEvent.click(options()[1]);
    fireEvent.click(screen.getByRole('button', { name: 'Завершить' }));
    const sheet = screen.getByRole('dialog', { name: 'Завершить контрольную?' });
    expect(plain(sheet.textContent)).toContain('Отвечено 1 из 3, без ответа: 2, 3 — они считаются ошибками.');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Завершить' }));
    await advance(0);
    // The waiting answer goes first, then the finish.
    expect(api.sendAnswers).toHaveBeenCalledWith('att-1', [{ item_id: 'i1', chosen: [1] }], null);
    expect(api.finishQuiz).toHaveBeenCalledWith('att-1', null);
    expect(api.sendAnswers.mock.invocationCallOrder[0]).toBeLessThan(api.finishQuiz.mock.invocationCallOrder[0]);
    expect(onResult).toHaveBeenCalledWith(expect.objectContaining({ attempt_id: 'att-1', finish_reason: 'sent' }));
    expect(api.track).toHaveBeenCalledWith('quiz.finished', expect.objectContaining({ reason: 'sent' }));
  });
});

describe('QuizRun: the end of the time', () => {
  it('at 0:00 sends the waiting answers, finishes and shows the result', async () => {
    api.finishQuiz.mockResolvedValue(RESULT);
    // One second left by the server's clock.
    renderRun(attempt({ deadline_at: '2026-10-16T10:00:01.000Z' }));
    expect(bar()).toBe('1 из 3 · осталось 00:01');
    await advance(700);
    fireEvent.click(options()[2]);
    expect(api.sendAnswers).not.toHaveBeenCalled();
    await advance(300);
    expect(api.sendAnswers).toHaveBeenCalledWith('att-1', [{ item_id: 'i1', chosen: [2] }], null);
    expect(api.finishQuiz).toHaveBeenCalledWith('att-1', null);
    expect(api.sendAnswers.mock.invocationCallOrder[0]).toBeLessThan(api.finishQuiz.mock.invocationCallOrder[0]);
    expect(onResult).toHaveBeenCalledWith(RESULT);
    expect(stored()).toBeNull();
  });

  it('an attempt whose time ran out while away ends at once', async () => {
    renderRun(attempt({ server_now: '2026-10-16T10:31:00.000Z' }));
    await advance(0);
    expect(api.finishQuiz).toHaveBeenCalledWith('att-1', null);
    expect(onResult).toHaveBeenCalled();
  });

  it('an answer the server no longer takes (MC012, past the grace) shows the result', async () => {
    api.sendAnswers.mockRejectedValue(new ContainerApiError('MC012', 'Время вышло: ответы больше не принимаются.', { status: 400 }));
    renderRun();
    fireEvent.click(options()[0]);
    await advance(SEND_DELAY_MS);
    expect(api.quizResult).toHaveBeenCalledWith('att-1', null);
    expect(api.finishQuiz).not.toHaveBeenCalled();
    expect(onResult).toHaveBeenCalledWith(RESULT);
    expect(stored()).toBeNull();
  });

  it('an attempt the server has not closed yet when the answer was refused is finished (quiz_finish is idempotent)', async () => {
    api.sendAnswers.mockRejectedValue(new ContainerApiError('MC012', 'Время вышло', { status: 400, detail: 'time' }));
    api.quizResult.mockRejectedValue(new ContainerApiError('22023', 'Попытка ещё не закончена.', { status: 400, detail: 'unfinished' }));
    renderRun();
    fireEvent.click(options()[0]);
    await advance(SEND_DELAY_MS);
    expect(api.finishQuiz).toHaveBeenCalledWith('att-1', null);
    expect(onResult).toHaveBeenCalledWith(expect.objectContaining({ attempt_id: 'att-1' }));
  });

  it('a finish the server refuses as over (MC012) shows the result too', async () => {
    api.finishQuiz.mockRejectedValue(new ContainerApiError('MC012', 'Время вышло', { status: 400 }));
    renderRun();
    fireEvent.click(screen.getByRole('button', { name: 'Завершить' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Завершить' }));
    await advance(0);
    expect(api.quizResult).toHaveBeenCalledWith('att-1', null);
    expect(onResult).toHaveBeenCalledWith(RESULT);
  });

  it('without network the finish waits and is tried again', async () => {
    api.finishQuiz.mockRejectedValueOnce(new ContainerApiError('network', 'Нет сети', { status: 0 })).mockResolvedValue(RESULT);
    renderRun();
    fireEvent.click(screen.getByRole('button', { name: 'Завершить' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Завершить' }));
    await advance(0);
    expect(screen.getByText(/Нет связи — ответы сохранятся, когда она вернётся/)).toBeInTheDocument();
    expect(onResult).not.toHaveBeenCalled();
    await advance(RETRY_MS[0]);
    expect(api.finishQuiz).toHaveBeenCalledTimes(2);
    expect(onResult).toHaveBeenCalledWith(RESULT);
  });

  it('an attempt the author reset goes back to the start', async () => {
    api.sendAnswers.mockRejectedValue(new ContainerApiError('P0002', 'Не найдено', { status: 400 }));
    renderRun();
    fireEvent.click(options()[0]);
    await advance(SEND_DELAY_MS);
    expect(onLost).toHaveBeenCalledWith(expect.stringContaining('сбросил'));
    expect(stored()).toBeNull();
  });
});

describe('QuizRun: a reload (review focus 1)', () => {
  it('the same questions in the same order, the server answers with the unsent ones of this device, the clock from the deadline', async () => {
    // Ten minutes in; this device kept an answer the server never got.
    window.localStorage.setItem(storeKey('att-1'), JSON.stringify({ i3: 'Париж', gone: [1] }));
    const resumed = attempt({
      server_now: '2026-10-16T10:10:00.000Z',
      shuffle_options: true,
      answers: [{ item_id: 'i1', chosen: [2], text: null }],
    });
    renderRun(resumed);
    // The first question without an answer; the clock counts to the same deadline: 20 minutes left.
    expect(bar()).toBe('2 из 3 · осталось 20:00');
    expect(plain(screen.getByText(/Попытка продолжается/).textContent)).toBe('Попытка продолжается: 2 из 3, осталось 20:00.');
    // The unsent answer goes at once.
    await advance(0);
    expect(api.sendAnswers).toHaveBeenCalledWith('att-1', [{ item_id: 'i3', text: 'Париж' }], null);
    // The same order as before the reload (the seed is the attempt and the question).
    fireEvent.click(screen.getByRole('button', { name: 'Назад' }));
    const order = optionOrder(4, false, pinnedLast(ITEMS[0].options), 'att-1:i1');
    expect(optionTexts()).toEqual(order.map((index) => ITEMS[0].options[index]));
    expect(options()[order.indexOf(2)]).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Дальше' }));
    fireEvent.click(screen.getByRole('button', { name: 'Дальше' }));
    expect(screen.getByLabelText('Ваш ответ')).toHaveValue('Париж');
  });

  it('only forward: goes on after the last answered question', () => {
    renderRun(attempt({ allow_back: false, answers: [{ item_id: 'i2', chosen: [1], text: null }] }));
    expect(bar()).toContain('3 из 3');
  });
});

describe('QuizRun: a guest without an account (release 47)', () => {
  it('every call of the attempt carries the device token: the answers, then the finish', async () => {
    renderRun(attempt(), TOKEN);
    fireEvent.click(options()[1]);
    await advance(SEND_DELAY_MS);
    expect(api.sendAnswers).toHaveBeenCalledWith('att-1', [{ item_id: 'i1', chosen: [1] }], TOKEN);
    fireEvent.click(screen.getByRole('button', { name: 'Завершить' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Завершить' }));
    await advance(0);
    expect(api.finishQuiz).toHaveBeenCalledWith('att-1', TOKEN);
    expect(onResult).toHaveBeenCalledWith(expect.objectContaining({ finish_reason: 'sent' }));
  });

  it('an attempt the server closed (MC012) reads its result with the token, finishing it when still open', async () => {
    api.sendAnswers.mockRejectedValue(new ContainerApiError('MC012', 'Время вышло', { status: 400, detail: 'time' }));
    api.quizResult.mockRejectedValue(new ContainerApiError('22023', 'Попытка ещё не закончена.', { status: 400, detail: 'unfinished' }));
    renderRun(attempt(), TOKEN);
    fireEvent.click(options()[0]);
    await advance(SEND_DELAY_MS);
    expect(api.quizResult).toHaveBeenCalledWith('att-1', TOKEN);
    expect(api.finishQuiz).toHaveBeenCalledWith('att-1', TOKEN);
    expect(onResult).toHaveBeenCalled();
  });

  it('the unsent answers of a reload go with the token too', async () => {
    window.localStorage.setItem(storeKey('att-1'), JSON.stringify({ i3: 'Париж' }));
    renderRun(attempt(), TOKEN);
    await advance(0);
    expect(api.sendAnswers).toHaveBeenCalledWith('att-1', [{ item_id: 'i3', text: 'Париж' }], TOKEN);
  });
});

describe('QuizRun: the time strip and the quiz colour (release 47)', () => {
  const strip = () => document.querySelector<HTMLElement>('.qt-time-left');

  it('with a timer: a strip along the top line shrinks to the deadline, a progressbar «Осталось времени»', async () => {
    // A quarter of an hour of the thirty is gone.
    renderRun(attempt({ server_now: '2026-10-16T10:15:00.000Z' }));
    const timer = screen.getByRole('progressbar', { name: 'Осталось времени' });
    expect(timer).toHaveClass('qt-time');
    // It rides the top line, under the clock it stands for.
    expect(timer.closest('header')).toBe(screen.getByRole('banner'));
    expect(timer).toHaveAttribute('aria-valuenow', '50');
    expect(plain(timer.getAttribute('aria-valuetext'))).toBe('осталось 15:00');
    expect(strip()?.style.transform).toBe('scaleX(0.5)');
    await advance(180_000);
    expect(strip()?.style.transform).toBe('scaleX(0.4)');
    expect(timer).toHaveAttribute('aria-valuenow', '40');
  });

  it('without a timer there is no strip', () => {
    renderRun(attempt({ deadline_at: null }));
    expect(document.querySelector('.qt-time')).toBeNull();
  });

  it('the sheets open outside the page, so they take the colour by class', () => {
    renderRun(attempt(), null, 'green');
    fireEvent.click(screen.getByRole('button', { name: 'Завершить' }));
    expect(screen.getByRole('dialog', { name: 'Завершить контрольную?' })).toHaveClass('qt-accent', 'qt-accent-green');
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Вернуться к вопросам' }));
    fireEvent.click(screen.getByRole('button', { name: 'Все вопросы' }));
    expect(screen.getByRole('dialog', { name: 'Все вопросы' })).toHaveClass('qt-accent', 'qt-accent-green');
  });

  it('without a colour the sheets are blue, Meldy’s own', () => {
    renderRun();
    fireEvent.click(screen.getByRole('button', { name: 'Завершить' }));
    expect(screen.getByRole('dialog')).toHaveClass('qt-accent-blue');
  });
});

describe('QuizRun: the question pictures (release 47)', () => {
  const C = '11111111-2222-4333-8444-555555555555';
  const STEM = `${C}/${'a'.repeat(64)}.png`;
  const OPTION = `${C}/${'b'.repeat(64)}.jpg`;
  const pictured = () => attempt({ items: [{ ...ITEMS[0], images: { stem: [STEM], options: [[OPTION], [], [], []] } }, ...ITEMS.slice(1)] });
  const shown = () => Array.from(document.querySelectorAll('.ct-pic img'), (img) => img.getAttribute('src'));

  it('a guest: through quiz-media with the attempt and the device token', async () => {
    renderRun(pictured(), TOKEN);
    await advance(0);
    expect(pictures.guestPictureUrl).toHaveBeenCalledWith(STEM, 'att-1', TOKEN);
    expect(pictures.guestPictureUrl).toHaveBeenCalledWith(OPTION, 'att-1', TOKEN);
    expect(pictures.pictureUrl).not.toHaveBeenCalled();
    expect(shown()).toEqual(['blob:guest', 'blob:guest']);
  });

  it('signed in: from the private bucket as before', async () => {
    renderRun(pictured());
    await advance(0);
    expect(pictures.pictureUrl).toHaveBeenCalledWith(STEM);
    expect(pictures.pictureUrl).toHaveBeenCalledWith(OPTION);
    expect(pictures.guestPictureUrl).not.toHaveBeenCalled();
    expect(shown()).toEqual(['blob:signed-in', 'blob:signed-in']);
  });

  it('the clock ticking does not ask for the pictures again', async () => {
    renderRun(pictured(), TOKEN);
    await advance(0);
    const asked = pictures.guestPictureUrl.mock.calls.length;
    expect(asked).toBe(2);
    await advance(3000);
    expect(bar()).toBe('1 из 3 · осталось 29:57');
    expect(pictures.guestPictureUrl).toHaveBeenCalledTimes(asked);
  });
});

describe('QuizRun: the last minutes (release 47 design fixes)', () => {
  const clock = () => screen.getByRole('banner').querySelector('.ct-rb-long .qt-clock');
  const status = () => document.querySelector('.qt-low');

  it('at 5:00 and at 1:00 the clock turns red and a status line says so, once each', async () => {
    // 5:02 left by the server's clock.
    renderRun(attempt({ deadline_at: '2026-10-16T10:05:02.000Z' }));
    expect(bar()).toBe('1 из 3 · осталось 05:02');
    expect(clock()).not.toHaveAttribute('data-low');
    expect(status()).toHaveAttribute('role', 'status');
    expect(status()?.textContent).toBe('');
    await advance(2000);
    expect(bar()).toBe('1 из 3 · осталось 05:00');
    expect(clock()).toHaveAttribute('data-low', '');
    expect(document.querySelector('.qt-time')).toHaveAttribute('data-low', '');
    expect(status()?.textContent).toBe('Осталось 5 минут');
    await advance(30_000);
    // Nothing new is said between the marks.
    expect(status()?.textContent).toBe('Осталось 5 минут');
    await advance(210_000);
    expect(bar()).toBe('1 из 3 · осталось 01:00');
    expect(status()?.textContent).toBe('Осталась 1 минута');
    expect(clock()).toHaveAttribute('data-low', '');
  });

  it('an attempt resumed past a mark is not told it again; the next one is said', async () => {
    // 4:00 left at the start: red already, nothing said.
    renderRun(attempt({ deadline_at: '2026-10-16T10:04:00.000Z' }));
    expect(clock()).toHaveAttribute('data-low', '');
    expect(status()?.textContent).toBe('');
    await advance(180_000);
    expect(status()?.textContent).toBe('Осталась 1 минута');
  });

  it('without a timer: no clock, no strip, nothing said', () => {
    renderRun(attempt({ deadline_at: null }));
    expect(clock()).toBeNull();
    expect(document.querySelector('.qt-time')).toBeNull();
    expect(status()?.textContent).toBe('');
  });
});
