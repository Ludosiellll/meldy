import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { QuizAttempt, QuizAttemptItem, QuizResult } from '../../types/quiz';

const api = vi.hoisted(() => ({
  sendAnswers: vi.fn(),
  finishQuiz: vi.fn(),
  quizResult: vi.fn(),
  track: vi.fn(),
}));
vi.mock('../../api/quizzes', () => ({ sendAnswers: api.sendAnswers, finishQuiz: api.finishQuiz, quizResult: api.quizResult }));
vi.mock('../../lib/telemetry', () => ({ track: api.track }));
vi.mock('../../lib/supabase', () => ({ supabase: { rpc: vi.fn(), storage: { from: vi.fn() } } }));

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

function renderRun(value: QuizAttempt = attempt()) {
  return render(<QuizRun attempt={value} onResult={onResult} onLost={onLost} />);
}

beforeEach(() => {
  vi.useFakeTimers({ now: DEVICE_NOW });
  window.localStorage.clear();
  onResult = vi.fn<(result: QuizResult) => void>();
  onLost = vi.fn<(message: string) => void>();
  api.sendAnswers.mockReset().mockImplementation(async () => saved());
  api.finishQuiz.mockReset().mockResolvedValue({ ...RESULT, finish_reason: 'sent' });
  api.quizResult.mockReset().mockResolvedValue(RESULT);
  api.track.mockReset();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('QuizRun: the clock', () => {
  it('counts to the server deadline, corrected by the difference of the clocks', async () => {
    renderRun();
    // The device is 2 minutes ahead: without the correction the bar would say 28:00.
    expect(bar()).toBe('Контрольная · 1 из 3 · 30:00');
    expect(plain(screen.getByRole('banner').querySelector('.ct-rb-short')?.textContent)).toBe('1 из 3 · 30:00');
    await advance(1000);
    expect(bar()).toBe('Контрольная · 1 из 3 · 29:59');
  });

  it('follows the deadline each save brings back (the author moved the closing)', async () => {
    api.sendAnswers.mockImplementation(async () => saved('2026-10-16T10:10:00.000Z'));
    renderRun();
    fireEvent.click(options()[0]);
    await advance(SEND_DELAY_MS);
    expect(bar()).toBe('Контрольная · 1 из 3 · 10:00');
  });

  it('corrects the clock by the server time each save brings back', async () => {
    // The device's clock jumps 5 minutes ahead (set by hand); the next save tells the difference again.
    renderRun();
    vi.setSystemTime(DEVICE_NOW + 5 * 60_000);
    api.sendAnswers.mockImplementation(async () => ({ saved: 1, server_now: '2026-10-16T10:00:01.000Z', deadline_at: '2026-10-16T10:30:00.000Z' }));
    fireEvent.click(options()[0]);
    await advance(SEND_DELAY_MS);
    expect(bar()).toBe('Контрольная · 1 из 3 · 29:59');
  });

  it('without a time limit shows no clock', () => {
    renderRun(attempt({ deadline_at: null }));
    expect(bar()).toBe('Контрольная · 1 из 3');
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
    ]);
    expect(stored()).toBeNull();
    expect(screen.getByText('Сохранено')).toBeInTheDocument();
  });

  it('a short answer is sent as text; taking a choice back sends an empty one', async () => {
    renderRun(attempt({ items: [ITEMS[2], ITEMS[0]] }));
    fireEvent.change(screen.getByLabelText('Ваш ответ'), { target: { value: ' Париж ' } });
    await advance(SEND_DELAY_MS);
    expect(api.sendAnswers).toHaveBeenLastCalledWith('att-1', [{ item_id: 'i3', text: 'Париж' }]);
    fireEvent.click(screen.getByRole('button', { name: 'Дальше' }));
    fireEvent.click(options()[0]);
    fireEvent.click(options()[0]);
    await advance(SEND_DELAY_MS);
    expect(api.sendAnswers).toHaveBeenLastCalledWith('att-1', [{ item_id: 'i1', chosen: [] }]);
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
    expect(api.sendAnswers).toHaveBeenLastCalledWith('att-1', [{ item_id: 'i1', chosen: [0] }]);
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
    expect(api.sendAnswers).toHaveBeenLastCalledWith('att-1', [{ item_id: 'i1', chosen: [2] }]);
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
    expect(api.sendAnswers).toHaveBeenCalledWith('att-1', [{ item_id: 'i1', chosen: [order[0]] }]);
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
    expect(api.sendAnswers).toHaveBeenCalledWith('att-1', [{ item_id: 'i1', chosen: [1] }]);
    expect(api.finishQuiz).toHaveBeenCalledWith('att-1');
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
    expect(bar()).toBe('Контрольная · 1 из 3 · 00:01');
    await advance(700);
    fireEvent.click(options()[2]);
    expect(api.sendAnswers).not.toHaveBeenCalled();
    await advance(300);
    expect(api.sendAnswers).toHaveBeenCalledWith('att-1', [{ item_id: 'i1', chosen: [2] }]);
    expect(api.finishQuiz).toHaveBeenCalledWith('att-1');
    expect(api.sendAnswers.mock.invocationCallOrder[0]).toBeLessThan(api.finishQuiz.mock.invocationCallOrder[0]);
    expect(onResult).toHaveBeenCalledWith(RESULT);
    expect(stored()).toBeNull();
  });

  it('an attempt whose time ran out while away ends at once', async () => {
    renderRun(attempt({ server_now: '2026-10-16T10:31:00.000Z' }));
    await advance(0);
    expect(api.finishQuiz).toHaveBeenCalledWith('att-1');
    expect(onResult).toHaveBeenCalled();
  });

  it('an answer the server no longer takes (MC012, past the grace) shows the result', async () => {
    api.sendAnswers.mockRejectedValue(new ContainerApiError('MC012', 'Время вышло: ответы больше не принимаются.', { status: 400 }));
    renderRun();
    fireEvent.click(options()[0]);
    await advance(SEND_DELAY_MS);
    expect(api.quizResult).toHaveBeenCalledWith('att-1');
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
    expect(api.finishQuiz).toHaveBeenCalledWith('att-1');
    expect(onResult).toHaveBeenCalledWith(expect.objectContaining({ attempt_id: 'att-1' }));
  });

  it('a finish the server refuses as over (MC012) shows the result too', async () => {
    api.finishQuiz.mockRejectedValue(new ContainerApiError('MC012', 'Время вышло', { status: 400 }));
    renderRun();
    fireEvent.click(screen.getByRole('button', { name: 'Завершить' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Завершить' }));
    await advance(0);
    expect(api.quizResult).toHaveBeenCalledWith('att-1');
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
    expect(bar()).toBe('Контрольная · 2 из 3 · 20:00');
    expect(plain(screen.getByText(/Попытка продолжается/).textContent)).toBe('Попытка продолжается: 2 из 3, осталось 20:00.');
    // The unsent answer goes at once.
    await advance(0);
    expect(api.sendAnswers).toHaveBeenCalledWith('att-1', [{ item_id: 'i3', text: 'Париж' }]);
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
