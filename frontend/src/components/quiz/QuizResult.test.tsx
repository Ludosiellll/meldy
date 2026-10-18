import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { QuizResult, QuizResultItem } from '../../types/quiz';

const api = vi.hoisted(() => ({ pictureUrl: vi.fn(), guestPictureUrl: vi.fn(), joinPractice: vi.fn() }));
vi.mock('../../api/itemPictures', () => ({ pictureUrl: api.pictureUrl, guestPictureUrl: api.guestPictureUrl, pictureDataUrl: () => null }));
vi.mock('../../api/quizzes', () => ({ joinPractice: api.joinPractice }));
vi.mock('../../lib/supabase', () => ({ supabase: { rpc: vi.fn(), storage: { from: vi.fn() } } }));

import QuizResultView from './QuizResult';
import { ContainerApiError } from '../../api/containers';
import { quizOrder } from '../../lib/quizzes/quizModel';
import { OPTION_LETTERS } from '../containers/copy';
import { QUIZ_ERRORS } from './copyQuiz';

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
let where = '';

function Where() {
  const location = useLocation();
  where = `${location.pathname}${location.search}`;
  return <p>Другая страница</p>;
}

function renderResult(value: QuizResult, guest = false, token: string | null = null) {
  return render(
    <MemoryRouter initialEntries={['/k/abcd2fghjkmn']}>
      <Routes>
        <Route
          path="/k/:code"
          element={
            <div className="ct-roomshell">
              <QuizResultView result={value} guest={guest} token={token} onRetry={onRetry} onClose={onClose} />
            </div>
          }
        />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  onRetry = vi.fn<() => void>();
  onClose = vi.fn<() => void>();
  where = '';
  api.pictureUrl.mockReset().mockResolvedValue('blob:picture');
  api.guestPictureUrl.mockReset().mockResolvedValue('blob:guest-picture');
  api.joinPractice.mockReset().mockResolvedValue({ container_id: 'cont-1' });
});
afterEach(() => cleanup());

describe('QuizResult: the score', () => {
  it('«15 из 20 · 75 %» and the pass mark — passed', () => {
    renderResult(result({ pass_percent: 60, passed: true }));
    expect(plain(document.querySelector('.qt-score')?.textContent)).toBe('15 из 20 · 75 %');
    // The start page's words for the pass mark.
    expect(page()).toContain('Проходной балл 60 % — сдано');
    expect(screen.getByRole('heading', { level: 1, name: 'Контрольная по базам данных' })).toBeInTheDocument();
    // A thin bar of the percent in the quiz's colour, a tick at the pass mark (decorative: the words say it).
    const meter = document.querySelector('.qt-meter')!;
    expect(meter).toHaveAttribute('aria-hidden', 'true');
    expect(meter.querySelector<HTMLElement>('.qt-meter-fill')?.style.width).toBe('75%');
    expect(meter.querySelector<HTMLElement>('.qt-meter-tick')?.style.left).toBe('60%');
  });

  it('not passed', () => {
    renderResult(result({ correct: 10, percent: 50, pass_percent: 60, passed: false }));
    expect(page()).toContain('Проходной балл 60 % — не сдано');
    expect(document.querySelector<HTMLElement>('.qt-meter-fill')?.style.width).toBe('50%');
  });

  it('score only: no questions, no answers, no other try', () => {
    renderResult(result({ review_now: 'score' }));
    expect(screen.queryByRole('heading', { name: 'Где вы ошиблись' })).toBeNull();
    expect(screen.queryByText(/Ваш ответ/)).toBeNull();
    expect(screen.queryByRole('button', { name: /Ещё попытка/ })).toBeNull();
    expect(page()).not.toContain('Проходной балл');
    // The bar without a pass mark has no tick.
    expect(document.querySelector('.qt-meter-fill')).not.toBeNull();
    expect(document.querySelector('.qt-meter-tick')).toBeNull();
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
    // The right one the person did not pick has its own look and words; their wrong pick says so.
    expect(rows[1].getAttribute('data-state')).toBe('missed');
    expect(plain(rows[1].querySelector('.ct-opt-tag')?.textContent)).toBe('Верный — вы не отметили');
    expect(rows[2].getAttribute('data-state')).toBe('wrong');
    expect(plain(rows[2].querySelector('.ct-opt-tag')?.textContent)).toBe('Ваш ответ — неверно');
    expect(rows[0].getAttribute('data-state')).toBeNull();
    expect(rows[0].querySelector('.ct-opt-tag')).toBeNull();
    const capital = screen.getByText('Столица Франции').closest('li')!;
    expect(capital.textContent).toContain('Верный ответ: Париж');
    // Nothing picked: both right options are «missed», none filled.
    const even = screen.getByText('Чётные числа').closest('li')!;
    expect(even.querySelectorAll('.ct-opt[data-state="missed"]').length).toBe(2);
    expect(even.querySelectorAll('.ct-opt[data-state="file"]').length).toBe(0);
  });

  it('answers: several right, one picked, one missed, one wrong pick — three looks, three tags', () => {
    const items: QuizResultItem[] = [{ ...ITEMS[3], chosen: [0, 1], key: [1, 2] }];
    renderResult(result({ review_now: 'answers', items }));
    const rows = Array.from(screen.getByText('Чётные числа').closest('li')!.querySelectorAll('.ct-opt'));
    expect(rows.map((row) => row.getAttribute('data-state'))).toEqual(['wrong', 'file', 'missed']);
    expect(rows.map((row) => plain(row.querySelector('.ct-opt-tag')?.textContent))).toEqual([
      'Ваш ответ — неверно',
      'Ваш ответ — верно',
      'Верный — вы не отметили',
    ]);
  });

  it('answers: «Показать все вопросы» opens the right ones too, in the attempt’s order', () => {
    const items: QuizResultItem[] = ITEMS.map((item) => ({ ...item, key: item.kind === 'short' ? null : [1], forms: item.kind === 'short' ? ['Париж'] : null }));
    renderResult(result({ review_now: 'answers', items }));
    expect(screen.queryByText('Сколько будет 2 + 2?')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: (name) => plain(name) === 'Показать все вопросы (4)' }));
    const first = screen.getByText('Сколько будет 2 + 2?').closest('li')!;
    expect(first.textContent).toContain('Вопрос 1');
    expect(plain(first.querySelector('.ct-opt[data-state="file"] .ct-opt-tag')?.textContent)).toBe('Ваш ответ — верно');
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
    expect(api.guestPictureUrl).not.toHaveBeenCalled();
  });

  it('a guest’s pictures come through quiz-media with the attempt and the device’s token (release 47)', async () => {
    const token = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_AbCdE';
    const items: QuizResultItem[] = [{ ...ITEMS[1], images: { stem: ['c1/stem.png'], options: [[], [], ['c1/red.png']] } }];
    renderResult(result({ review_now: 'mistakes', items }), true, token);
    await waitFor(() => expect(document.querySelectorAll('.ct-pic img').length).toBe(2));
    expect(api.guestPictureUrl).toHaveBeenCalledWith('c1/stem.png', 'att-1', token);
    expect(api.guestPictureUrl).toHaveBeenCalledWith('c1/red.png', 'att-1', token);
    expect(api.pictureUrl).not.toHaveBeenCalled();
    expect(Array.from(document.querySelectorAll('.ct-pic img'), (img) => img.getAttribute('src'))).toEqual(['blob:guest-picture', 'blob:guest-picture']);
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

describe('the author’s explanation in the review (release 47)', () => {
  const keyed = (over: Partial<QuizResultItem>): QuizResultItem => ({ ...ITEMS[1], key: [1], ...over });

  it('stands under the question with its label, the author’s line breaks kept', () => {
    renderResult(result({ review_now: 'answers', items: [keyed({ explanation: 'Рэлеевское рассеяние.\nКороткие волны рассеиваются сильнее.' })] }));
    const sky = screen.getByText('Какой цвет у неба?').closest('li')!;
    const box = sky.querySelector('.qt-explain')!;
    expect(within(sky).getByText('Пояснение')).toBeInTheDocument();
    expect(box.querySelector('.qt-explain-t')?.textContent).toBe('Рэлеевское рассеяние.\nКороткие волны рассеиваются сильнее.');
    // After the options: the explanation reads after the answer.
    const options = sky.querySelector('.qt-opts')!;
    expect(options.compareDocumentPosition(box) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('none, empty or only spaces: nothing', () => {
    renderResult(result({ review_now: 'answers', items: [keyed({ explanation: '  \n ' }), keyed({ id: 'i5', stem: 'Второй', explanation: null }), keyed({ id: 'i6', stem: 'Третий' })] }));
    expect(screen.queryByText('Пояснение')).toBeNull();
    expect(document.querySelector('.qt-explain')).toBeNull();
  });
});

describe('«Повторить эти вопросы» (release 47)', () => {
  const NOTE = 'Meldy будет возвращать вопросы, пока вы их не запомните. Автор увидит только, что вы присоединились.';
  const offered = (over: Partial<QuizResult> = {}) => result({ practice: { exam_title: 'Зимняя сессия', member: false }, ...over });

  it('signed in: the note first, then the button; it joins and opens the exam', async () => {
    renderResult(offered());
    const note = screen.getByText((_, node) => node?.classList.contains('qt-practice-note') === true && plain(node.textContent) === NOTE);
    const button = screen.getByRole('button', { name: 'Тренировать эти вопросы' });
    expect(note.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // No other try: this is the screen's one blue pill.
    expect(button).toHaveClass('sf-primary');
    fireEvent.click(button);
    await waitFor(() => expect(where).toBe('/exams/c/cont-1'));
    expect(api.joinPractice).toHaveBeenCalledWith('abcd2fghjkmn');
  });

  it('with «Ещё попытка» on the screen the button is the white pill', () => {
    renderResult(offered({ can_retry: true, attempts_left: 1 }));
    expect(screen.getByRole('button', { name: 'Тренировать эти вопросы' })).toHaveClass('sf-secondary');
  });

  it('a member already: «Открыть экзамен» asks for the exam’s id and opens it', async () => {
    renderResult(offered({ practice: { exam_title: 'Зимняя сессия', member: true } }));
    expect(screen.queryByRole('button', { name: 'Тренировать эти вопросы' })).toBeNull();
    expect(plain(document.querySelector('.qt-practice-note')?.textContent)).toBe('Вы уже участник экзамена «Зимняя сессия».');
    fireEvent.click(screen.getByRole('button', { name: 'Открыть экзамен' }));
    await waitFor(() => expect(where).toBe('/exams/c/cont-1'));
    expect(api.joinPractice).toHaveBeenCalledWith('abcd2fghjkmn');
  });

  it('a guest: an account first, coming back to the quiz with ?practice=1; nothing joined from here', () => {
    renderResult(offered(), true);
    expect(plain(document.querySelector('.qt-practice-note')?.textContent)).toBe(NOTE);
    const link = screen.getByRole('link', { name: 'Создать аккаунт и тренироваться' });
    expect(link).toHaveAttribute('href', `/register?next=${encodeURIComponent('/k/abcd2fghjkmn?practice=1')}`);
    expect(screen.queryByRole('button', { name: 'Тренировать эти вопросы' })).toBeNull();
    fireEvent.click(link);
    expect(where).toBe(`/register?next=${encodeURIComponent('/k/abcd2fghjkmn?practice=1')}`);
    expect(api.joinPractice).not.toHaveBeenCalled();
  });

  it.each([
    ['practice', QUIZ_ERRORS.MC018_practice],
    ['removed', QUIZ_ERRORS.MC018_removed],
    ['full', QUIZ_ERRORS.MC018_full],
    ['open', QUIZ_ERRORS.MC018_open],
  ])('MC018 %s is said in place and the button works again', async (detail, words) => {
    api.joinPractice.mockRejectedValueOnce(new ContainerApiError('MC018', words, { status: 400, detail }));
    renderResult(offered());
    const button = screen.getByRole('button', { name: 'Тренировать эти вопросы' });
    fireEvent.click(button);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(words);
    expect(alert.closest('.qt-practice')).not.toBeNull();
    expect(where).toBe('');
    expect(button).not.toBeDisabled();
    fireEvent.click(button);
    await waitFor(() => expect(where).toBe('/exams/c/cont-1'));
  });

  describe('while a quiz of the exam is open or not yet open (ready false, 20261018130000_quiz_guards)', () => {
    const LATER = 'Тренировка по всем вопросам откроется, когда контрольная закроется.';

    it.each([
      ['signed in', false, false],
      ['a member already', true, false],
      ['a guest', false, true],
    ] as const)('%s: no button, a quiet line under the title; nothing joined', (_who, member, guest) => {
      renderResult(offered({ practice: { exam_title: 'Зимняя сессия', member, ready: false } }), guest);
      expect(screen.getByRole('heading', { name: 'Повторить эти вопросы' })).toBeInTheDocument();
      expect(plain(document.querySelector('.qt-practice-note')?.textContent)).toBe(LATER);
      expect(document.querySelectorAll('.qt-practice-note')).toHaveLength(1);
      expect(document.querySelector('.qt-practice button, .qt-practice a')).toBeNull();
      expect(screen.queryByRole('button', { name: 'Тренировать эти вопросы' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Открыть экзамен' })).toBeNull();
      expect(screen.queryByRole('link', { name: 'Создать аккаунт и тренироваться' })).toBeNull();
      expect(page()).not.toContain('Meldy будет возвращать');
      expect(api.joinPractice).not.toHaveBeenCalled();
    });

    it('«Ещё попытка» stays the screen’s blue pill', () => {
      renderResult(offered({ can_retry: true, attempts_left: 1, practice: { exam_title: 'Зимняя сессия', member: false, ready: false } }));
      expect(screen.getByRole('button', { name: /Ещё попытка/ })).toHaveClass('sf-primary');
      expect(plain(document.querySelector('.qt-practice-note')?.textContent)).toBe(LATER);
    });

    it('ready true: the button as before', () => {
      renderResult(offered({ practice: { exam_title: 'Зимняя сессия', member: false, ready: true } }));
      expect(screen.getByRole('button', { name: 'Тренировать эти вопросы' })).toHaveClass('sf-primary');
      expect(page()).not.toContain(LATER);
    });

    it('a server without ready (before the guards): read as open', () => {
      renderResult(offered());
      expect(screen.getByRole('button', { name: 'Тренировать эти вопросы' })).toBeInTheDocument();
      expect(page()).not.toContain(LATER);
    });
  });

  it('not offered: no block', () => {
    renderResult(result({ practice: null }));
    expect(screen.queryByRole('heading', { name: 'Повторить эти вопросы' })).toBeNull();
    expect(screen.queryByText(/Тренировать/)).toBeNull();
  });
});
