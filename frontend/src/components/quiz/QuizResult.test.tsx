import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { QuizResult, QuizResultItem } from '../../types/quiz';

const api = vi.hoisted(() => ({ pictureUrl: vi.fn() }));
vi.mock('../../api/itemPictures', () => ({ pictureUrl: api.pictureUrl, pictureDataUrl: () => null }));
vi.mock('../../lib/supabase', () => ({ supabase: { rpc: vi.fn(), storage: { from: vi.fn() } } }));

import QuizResultView from './QuizResult';
import { quizOrder } from '../../lib/quizzes/quizModel';
import { OPTION_LETTERS } from '../containers/copy';

const NB = String.fromCharCode(0xa0);
const plain = (text: string | null | undefined) => (text ?? '').split(NB).join(' ');
const page = () => plain(document.body.textContent);

const ITEMS: QuizResultItem[] = [
  { id: 'i1', kind: 'single', stem: 'Сколько будет 2 + 2?', options: ['3', '4', '5'], code: false, keep_order: false, images: null, chosen: [1], text: null, right: true, key: null, forms: null },
  { id: 'i2', kind: 'single', stem: 'Какой цвет у неба?', options: ['Зелёный', 'Синий', 'Красный'], code: false, keep_order: false, images: null, chosen: [2], text: null, right: false, key: null, forms: null },
  { id: 'i3', kind: 'short', stem: 'Столица Франции', options: [], code: false, keep_order: false, images: null, chosen: null, text: 'Лион', right: false, key: null, forms: null },
  { id: 'i4', kind: 'multiple', stem: 'Чётные числа', options: ['1', '2', '4'], code: false, keep_order: false, images: null, chosen: null, text: null, right: false, key: null, forms: null },
];

function result(over: Partial<QuizResult> = {}): QuizResult {
  return {
    attempt_id: 'att-1',
    n: 1,
    quiz_title: 'Контрольная по базам данных',
    code: 'abcd2fghjkmn',
    started_at: '2026-10-16T10:00:00.000Z',
    finished_at: '2026-10-16T10:20:00.000Z',
    finish_reason: 'sent',
    correct: 15,
    total: 20,
    percent: 75,
    pass_percent: null,
    passed: null,
    review_now: 'score',
    answers_after: null,
    attempts_left: 0,
    can_retry: false,
    items: [],
    ...over,
  };
}

let onRetry: Mock<() => void>;
let onClose: Mock<() => void>;

function renderResult(value: QuizResult) {
  return render(
    <div className="ct-roomshell">
      <QuizResultView result={value} onRetry={onRetry} onClose={onClose} />
    </div>,
  );
}

beforeEach(() => {
  onRetry = vi.fn<() => void>();
  onClose = vi.fn<() => void>();
  api.pictureUrl.mockReset().mockResolvedValue('blob:picture');
});
afterEach(() => cleanup());

describe('QuizResult: the score', () => {
  it('«15 из 20 · 75 %» and the pass mark — passed', () => {
    renderResult(result({ pass_percent: 60, passed: true }));
    expect(plain(document.querySelector('.qt-score')?.textContent)).toBe('15 из 20 · 75 %');
    expect(page()).toContain('Порог 60 % — сдано');
    expect(screen.getByRole('heading', { level: 1, name: 'Контрольная по базам данных' })).toBeInTheDocument();
  });

  it('not passed', () => {
    renderResult(result({ correct: 10, percent: 50, pass_percent: 60, passed: false }));
    expect(page()).toContain('Порог 60 % — не сдано');
  });

  it('score only: no questions, no answers, no other try', () => {
    renderResult(result({ review_now: 'score' }));
    expect(screen.queryByRole('heading', { name: 'Где вы ошиблись' })).toBeNull();
    expect(screen.queryByText(/Ваш ответ/)).toBeNull();
    expect(screen.queryByRole('button', { name: /Ещё попытка/ })).toBeNull();
    expect(page()).not.toContain('Порог');
  });

  it('says when the time closed the attempt', () => {
    renderResult(result({ finish_reason: 'time' }));
    expect(page()).toContain('Время вышло — попытка закрылась сама.');
  });

  it('«Закрыть» goes back', () => {
    renderResult(result());
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }));
    expect(onClose).toHaveBeenCalled();
  });
});

describe('QuizResult: the review', () => {
  it('mistakes: the wrong ones with the person’s answer, no right answer, and when the right answers open', () => {
    const after = new Date(2026, 9, 24, 18, 0).toISOString();
    renderResult(result({ review_now: 'mistakes', answers_after: after, items: ITEMS }));
    expect(screen.getByRole('heading', { name: 'Где вы ошиблись' })).toBeInTheDocument();
    expect(page()).toContain('Верные ответы откроются после 24 окт., 18:00.');
    // The right question is not listed; the wrong ones keep their number in the attempt.
    expect(screen.queryByText('Сколько будет 2 + 2?')).toBeNull();
    const sky = screen.getByText('Какой цвет у неба?').closest('li')!;
    expect(plain(within(sky).getByText('Вопрос 2').textContent)).toBe('Вопрос 2');
    const mine = sky.querySelector('.ct-opt[data-state="mine"]')!;
    expect(mine.textContent).toContain('Красный');
    expect(mine.textContent).toContain('Ваш ответ');
    expect(sky.textContent).not.toMatch(/Верн/);
    const capital = screen.getByText('Столица Франции').closest('li')!;
    expect(capital.textContent).toContain('Ваш ответ: Лион');
    expect(capital.textContent).not.toMatch(/Верн/);
    const even = screen.getByText('Чётные числа').closest('li')!;
    expect(even.textContent).toContain('Вопрос 4 · без ответа');
  });

  it('answers: the right ones too, with the letters of the file', () => {
    const items: QuizResultItem[] = ITEMS.map((item) =>
      item.id === 'i2' ? { ...item, key: [1] } : item.id === 'i3' ? { ...item, forms: ['Париж'] } : item.id === 'i4' ? { ...item, key: [1, 2] } : { ...item, key: [1] },
    );
    renderResult(result({ review_now: 'answers', items }));
    expect(screen.getByRole('heading', { name: 'Ошибки и верные ответы' })).toBeInTheDocument();
    const sky = screen.getByText('Какой цвет у неба?').closest('li')!;
    const rows = Array.from(sky.querySelectorAll('.ct-opt'));
    expect(rows.map((row) => row.querySelector('.ct-opt-l')?.textContent)).toEqual(['А', 'Б', 'В']);
    expect(rows[1].getAttribute('data-state')).toBe('file');
    expect(rows[1].textContent).toContain('Верный');
    expect(rows[2].getAttribute('data-state')).toBe('wrong');
    expect(rows[2].textContent).toContain('Ваш ответ');
    const capital = screen.getByText('Столица Франции').closest('li')!;
    expect(capital.textContent).toContain('Верный ответ: Париж');
    const even = screen.getByText('Чётные числа').closest('li')!;
    expect(even.querySelectorAll('.ct-opt[data-state="file"]').length).toBe(2);
  });

  it('answers: «Показать все вопросы» opens the right ones too, in the attempt’s order', () => {
    const items: QuizResultItem[] = ITEMS.map((item) => ({ ...item, key: item.kind === 'short' ? null : [1], forms: item.kind === 'short' ? ['Париж'] : null }));
    renderResult(result({ review_now: 'answers', items }));
    expect(screen.queryByText('Сколько будет 2 + 2?')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: (name) => plain(name) === 'Показать все вопросы (4)' }));
    const first = screen.getByText('Сколько будет 2 + 2?').closest('li')!;
    expect(first.textContent).toContain('Вопрос 1');
    expect(first.querySelector('.ct-opt[data-state="file"]')?.textContent).toContain('Ваш ответ, верный');
    fireEvent.click(screen.getByRole('button', { name: 'Показать только ошибки' }));
    expect(screen.queryByText('Сколько будет 2 + 2?')).toBeNull();
  });

  it('mistakes never offers the right questions (they would give the key away)', () => {
    renderResult(result({ review_now: 'mistakes', items: ITEMS }));
    expect(screen.queryByRole('button', { name: /Показать все/ })).toBeNull();
  });

  it('no mistakes: says so', () => {
    renderResult(result({ review_now: 'mistakes', correct: 1, total: 1, percent: 100, items: [ITEMS[0]] }));
    expect(screen.getByText('Ошибок нет.')).toBeInTheDocument();
  });

  it('pictures come from the storage paths', async () => {
    const items: QuizResultItem[] = [{ ...ITEMS[1], images: { stem: ['c1/stem.png'], options: [[], [], ['c1/red.png']] } }];
    renderResult(result({ review_now: 'mistakes', items }));
    await waitFor(() => expect(document.querySelectorAll('.ct-pic img').length).toBe(2));
    expect(api.pictureUrl).toHaveBeenCalledWith('c1/stem.png');
    expect(api.pictureUrl).toHaveBeenCalledWith('c1/red.png');
  });
});

describe('QuizResult: another try', () => {
  it.each([
    [1, 'Ещё попытка (осталась 1)'],
    [2, 'Ещё попытка (осталось 2)'],
    [null, 'Ещё попытка'],
  ])('with %s left: «%s»', (left, label) => {
    renderResult(result({ can_retry: true, attempts_left: left }));
    const button = screen.getByRole('button', { name: (name) => plain(name) === label });
    fireEvent.click(button);
    expect(onRetry).toHaveBeenCalled();
  });
});

describe('the options stand as the attempt showed them (release 46.1)', () => {
  const item: QuizResultItem = {
    id: 'i9', kind: 'single', stem: 'Какой паттерн?', options: ['MVC', 'MVP', 'MVVM', 'Во всех трёх', 'Ни в одном'],
    code: false, keep_order: false, images: null, chosen: [4], text: null, right: false, key: null, forms: null,
  };
  const rowsOf = () => within(screen.getByRole('list', { name: 'Варианты ответа' })).getAllByRole('listitem').map((li) => plain(li.textContent));

  it('shuffled: the same order and letters as during the attempt, the chosen one under its letter', () => {
    const order = quizOrder(item, 'att-1', true);
    expect(order).not.toEqual([0, 1, 2, 3, 4]);
    renderResult(result({ review_now: 'mistakes', shuffle_options: true, correct: 0, total: 1, percent: 0, items: [item] }));
    const rows = rowsOf();
    order.forEach((file, place) => expect(rows[place].startsWith(`${OPTION_LETTERS[place]}${item.options[file]}`)).toBe(true));
    const mine = order.indexOf(4);
    expect(rows[mine]).toContain('Ни в одном');
    expect(rows[mine]).toContain('Ваш ответ');
  });

  it('a question that keeps its order, or a quiz without shuffling, or an older server: the file’s order', () => {
    renderResult(result({ review_now: 'mistakes', shuffle_options: true, items: [{ ...item, keep_order: true }] }));
    expect(rowsOf().map((row) => row.slice(1, 4))).toEqual(['MVC', 'MVP', 'MVV', 'Во ', 'Ни ']);
    cleanup();
    renderResult(result({ review_now: 'mistakes', items: [item] }));
    expect(rowsOf()[0].startsWith('АMVC')).toBe(true);
  });
});
