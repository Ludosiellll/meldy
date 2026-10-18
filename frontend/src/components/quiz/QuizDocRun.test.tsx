import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { QuizAttempt, QuizAttemptItem, QuizResult } from '../../types/quiz';
import type { DocBlock, DocDesign, DocLayout } from '../../types/testDoc';

const api = vi.hoisted(() => ({ sendAnswers: vi.fn(), finishQuiz: vi.fn(), quizResult: vi.fn(), track: vi.fn(), pictureUrl: vi.fn(), guestPictureUrl: vi.fn() }));
vi.mock('../../api/quizzes', () => ({ sendAnswers: api.sendAnswers, finishQuiz: api.finishQuiz, quizResult: api.quizResult }));
vi.mock('../../lib/telemetry', () => ({ track: api.track }));
vi.mock('../../lib/supabase', () => ({ supabase: { rpc: vi.fn(), storage: { from: () => ({ getPublicUrl: (path: string) => ({ data: { publicUrl: `https://covers.test/${path}` } }) }) } } }));
vi.mock('../../api/itemPictures', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/itemPictures')>()),
  coverUrl: (path: string) => `https://covers.test/${path}`,
  pictureUrl: api.pictureUrl,
  guestPictureUrl: api.guestPictureUrl,
}));

import QuizRun, { SEND_DELAY_MS, storeKey } from './QuizRun';
import { RUN } from './copyTake';
import { DOC } from '../studio/copyStudio';

/**
 * QuizRun with `attempt.design` (release 47.2): the studio's page drawn by QuizDocRun over useAttempt — the answers
 * saved as in the usual attempt, the layouts, the required questions, the theme on the sheets.
 */

const NB = String.fromCharCode(0xa0);
const plain = (text: string | null | undefined) => (text ?? '').split(NB).join(' ');
const bar = () => plain(document.querySelector('.ct-rb-long')?.textContent);
const SERVER_NOW = '2026-10-18T10:00:00.000Z';
const EXAM = '11111111-2222-4333-8444-555555555555';

const ITEMS: QuizAttemptItem[] = [
  { id: 'i1', kind: 'single', stem: 'Какая кислота сильная?', options: ['Угольная', 'Серная', 'Кремниевая'], code: false, keep_order: false, images: null },
  { id: 'i2', kind: 'multiple', stem: 'Что растворимо в воде?', options: ['NaOH', 'Cu(OH)₂', 'KOH'], code: false, keep_order: false, images: null },
  { id: 'i3', kind: 'short', stem: 'Реакция кислоты с основанием?', options: [], code: false, keep_order: false, images: null },
];

function design(layout: DocLayout, blocks?: DocBlock[]): DocDesign {
  return {
    title: 'Кислоты',
    theme: { accent: { custom: '#3fb68b' }, background: { kind: 'plain' }, font: 'onest', radius: 'soft', density: 'airy', answers: 'list', buttons: 'pill' },
    layout,
    blocks: blocks ?? [
      { type: 'cover', id: 'cover0000001', title: 'Кислоты и основания', subtitle: 'Проверочная', image: `${EXAM}/${'a'.repeat(64)}.jpg`, align: 'left' },
      { type: 'question', id: 'quest0000001', item_id: 'i1', points: 1, required: true },
      { type: 'note', id: 'note00000001', tone: 'tip', text: 'Вспомните **таблицу растворимости**' },
      { type: 'question', id: 'quest0000002', item_id: 'i2', points: 2, required: false },
      { type: 'page', id: 'page00000001', title: 'Часть 2' },
      { type: 'question', id: 'quest0000003', item_id: 'i3', points: 3, required: true },
    ],
    results: { bands: [], cta: null },
  };
}

function attempt(layout: DocLayout, over: Partial<QuizAttempt> = {}): QuizAttempt {
  return {
    attempt_id: 'att-d',
    n: 1,
    quiz_title: 'Кислоты',
    server_now: SERVER_NOW,
    started_at: SERVER_NOW,
    deadline_at: '2026-10-18T10:15:00.000Z',
    allow_back: true,
    shuffle_options: false,
    design: design(layout),
    items: ITEMS,
    answers: [],
    ...over,
  };
}

const RESULT: QuizResult = {
  attempt_id: 'att-d',
  n: 1,
  quiz_title: 'Кислоты',
  code: 'abcd2fghjkmn',
  started_at: SERVER_NOW,
  finished_at: SERVER_NOW,
  finish_reason: 'sent',
  correct: 2,
  total: 3,
  score: 4,
  max_score: 6,
  percent: 67,
  pass_percent: null,
  passed: null,
  review_now: 'score',
  answers_after: null,
  attempts_left: 0,
  can_retry: false,
  items: [],
};

const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

let onResult: Mock<(result: QuizResult) => void>;
let onLost: Mock<(message: string) => void>;

function run(value: QuizAttempt, token: string | null = null) {
  return render(<QuizRun attempt={value} token={token} dark={false} onResult={onResult} onLost={onLost} />);
}

const next = () => fireEvent.click(document.querySelector('.dv-nav .dv-btn') as HTMLElement);

beforeEach(() => {
  vi.useFakeTimers({ now: Date.parse(SERVER_NOW) });
  window.localStorage.clear();
  onResult = vi.fn<(result: QuizResult) => void>();
  onLost = vi.fn<(message: string) => void>();
  api.sendAnswers.mockReset().mockImplementation(async () => ({ saved: 1, server_now: new Date().toISOString(), deadline_at: '2026-10-18T10:15:00.000Z' }));
  api.finishQuiz.mockReset().mockResolvedValue(RESULT);
  api.quizResult.mockReset().mockResolvedValue(RESULT);
  api.track.mockReset();
  api.pictureUrl.mockReset().mockResolvedValue('blob:signed-in');
  api.guestPictureUrl.mockReset().mockResolvedValue('blob:guest');
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('QuizRun «как в студии»: «По одному»', () => {
  it('a screen a question with the blocks before it; the cover only as its title; the answer saved as always', async () => {
    run(attempt('one_by_one'));
    expect(document.querySelector('.dv')).not.toBeNull();
    expect(bar()).toBe('1 из 3 · осталось 15:00');
    expect(screen.getByRole('heading', { name: 'Кислоты и основания' })).toBeInTheDocument();
    expect(document.querySelector('.dv-cover')).toBeNull();
    expect(screen.queryByText('Проверочная')).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: /Серная/ }));
    expect(window.localStorage.getItem(storeKey('att-d'))).toBe(JSON.stringify({ i1: [1] }));
    await advance(SEND_DELAY_MS);
    expect(api.sendAnswers).toHaveBeenCalledWith('att-d', [{ item_id: 'i1', chosen: [1] }], null);
    expect(screen.getByText(RUN.saved)).toBeInTheDocument();
    next();
    expect(bar()).toBe('2 из 3 · осталось 15:00');
    // The note stands above the question it precedes.
    const note = screen.getByText('таблицу растворимости', { exact: false }).closest('.dv-note')!;
    const question = screen.getByText('Что растворимо в воде?').closest('.dv-q')!;
    expect(note.compareDocumentPosition(question) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(plain(document.activeElement?.textContent)).toBe(plain(RUN.questionOf(2, 3)));
    fireEvent.click(screen.getByRole('button', { name: DOC.back }));
    expect(screen.getByRole('radio', { name: /Серная/ })).toHaveAttribute('aria-checked', 'true');
  });

  it('goes on from the first question without an answer', () => {
    run(attempt('one_by_one', { answers: [{ item_id: 'i1', chosen: [1], text: null }] }));
    expect(bar()).toBe('2 из 3 · осталось 15:00');
  });

  it('only forward: no «Все вопросы», «Дальше» asks for a required question first', () => {
    run(attempt('one_by_one', { allow_back: false }));
    expect(screen.queryByRole('button', { name: RUN.all })).toBeNull();
    expect(screen.getByText(RUN.forwardOnly)).toBeInTheDocument();
    next();
    expect(screen.getByRole('alert')).toHaveTextContent(DOC.missing([1]));
    expect(bar()).toBe('1 из 3 · осталось 15:00');
    fireEvent.click(screen.getByRole('radio', { name: /Угольная/ }));
    expect(screen.queryByRole('alert')).toBeNull();
    next();
    expect(bar()).toBe('2 из 3 · осталось 15:00');
    expect(screen.queryByRole('button', { name: DOC.back })).toBeNull();
  });
});

describe('QuizRun «как в студии»: «Одна страница» and «Завершить»', () => {
  it('every block on one page; «Завершить» names the required questions and asks nothing more until they have an answer', async () => {
    run(attempt('one_page'));
    expect(bar()).toBe('Отвечено 0 из 3 · осталось 15:00');
    expect(screen.getAllByRole('region')).toHaveLength(3);
    // «Новая страница» means nothing on one page.
    expect(screen.queryByText('Часть 2')).toBeNull();
    next();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('alert')).toHaveTextContent(DOC.missing([1, 3]));
    expect(document.querySelectorAll('.dv-q[data-missing]')).toHaveLength(2);
    // The first of them takes the focus.
    expect(document.activeElement?.id).toBe('dv-q-quest0000001');
    // The top line's «Завершить» asks for them too.
    fireEvent.click(document.querySelector('.ct-rb-exit') as HTMLElement);
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: /Серная/ }));
    expect(screen.getByRole('alert')).toHaveTextContent(DOC.missing([3]));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'нейтрализация' } });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(bar()).toBe('Отвечено 2 из 3 · осталось 15:00');
    next();
    const dialog = screen.getByRole('dialog', { name: RUN.finishTitle });
    expect(plain(dialog.textContent)).toContain(plain(RUN.finishLine(2, 3, [2])));
    // The page's colours on the sheet, which opens outside the page.
    expect(dialog.className).toContain('qt-design');
    expect(dialog.style.getPropertyValue('--qt-fill')).toMatch(/^#[0-9a-f]{6}$/);
    fireEvent.click(within(dialog).getByRole('button', { name: RUN.finish }));
    await advance(0);
    expect(api.sendAnswers).toHaveBeenCalledWith('att-d', [{ item_id: 'i1', chosen: [1] }, { item_id: 'i3', text: 'нейтрализация' }], null);
    expect(api.finishQuiz).toHaveBeenCalledWith('att-d', null);
    expect(onResult).toHaveBeenCalledWith(RESULT);
  });

  it('the clock at 0:00 sends what there is, required or not', async () => {
    run(attempt('one_page', { deadline_at: '2026-10-18T10:00:03.000Z' }));
    await advance(3000);
    expect(api.finishQuiz).toHaveBeenCalledWith('att-d', null);
    expect(onResult).toHaveBeenCalled();
  });

  it('«Все вопросы»: a cell a question by the page’s numbers; a press brings it into view', () => {
    run(attempt('one_page', { answers: [{ item_id: 'i2', chosen: [0], text: null }] }));
    fireEvent.click(screen.getByRole('button', { name: RUN.all }));
    const dialog = screen.getByRole('dialog', { name: RUN.all });
    const cells = within(dialog).getAllByRole('button').filter((button) => /^Вопрос/.test(button.getAttribute('aria-label') ?? ''));
    expect(cells.map((cell) => cell.getAttribute('aria-label'))).toEqual([RUN.cell(1, false), RUN.cell(2, true), RUN.cell(3, false)]);
    fireEvent.click(cells[2]);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement?.id).toBe('dv-q-quest0000003');
  });
});

describe('QuizRun «как в студии»: «По страницам»', () => {
  it('«Дальше» asks for the page’s required questions, then the next page; «Назад» goes back', () => {
    run(attempt('pages'));
    expect(bar()).toBe('Страница 1 из 2 · осталось 15:00');
    expect(plain(document.querySelector('.ct-rb-short')?.textContent)).toBe('Страница 1 из 2 · 15:00');
    next();
    expect(screen.getByRole('alert')).toHaveTextContent(DOC.missing([1]));
    fireEvent.click(screen.getByRole('radio', { name: /Серная/ }));
    next();
    expect(bar()).toBe('Страница 2 из 2 · осталось 15:00');
    expect(screen.getByRole('heading', { name: 'Часть 2' })).toBeInTheDocument();
    expect(document.querySelector('.dv-nav .dv-btn')).toHaveTextContent(DOC.finish);
    fireEvent.click(screen.getByRole('button', { name: DOC.back }));
    expect(bar()).toBe('Страница 1 из 2 · осталось 15:00');
  });

  it('«Завершить» from the first page goes to the page of a required question without an answer', () => {
    run(attempt('pages', { answers: [{ item_id: 'i1', chosen: [0], text: null }] }));
    expect(bar()).toBe('Страница 1 из 2 · осталось 15:00');
    fireEvent.click(document.querySelector('.ct-rb-exit') as HTMLElement);
    expect(bar()).toBe('Страница 2 из 2 · осталось 15:00');
    expect(screen.getByRole('alert')).toHaveTextContent(DOC.missing([3]));
    expect(document.activeElement?.id).toBe('dv-q-quest0000003');
  });
});

describe('QuizRun «как в студии»: the page and the attempt’s questions', () => {
  it('leaves out a question block the attempt does not hold, and puts the attempt’s questions the page lost at the end', () => {
    const blocks: DocBlock[] = [
      { type: 'question', id: 'quest0000009', item_id: 'not-in-attempt', points: 5, required: true },
      { type: 'question', id: 'quest0000002', item_id: 'i2', points: 2, required: false },
      { type: 'question', id: 'quest0000001', item_id: 'i1', points: 1, required: false },
    ];
    run(attempt('one_page', { design: design('one_page', blocks) }));
    const stems = Array.from(document.querySelectorAll('.dv-stem')).map((node) => node.textContent);
    expect(stems).toEqual(['Что растворимо в воде?', 'Какая кислота сильная?', 'Реакция кислоты с основанием?']);
    expect(plain(document.querySelector('.dv-q-head')?.textContent)).toBe('Вопрос 12 балла');
  });

  it('the options in the attempt’s order, as the review will have them', () => {
    run(attempt('one_page', { shuffle_options: true, items: [ITEMS[0]], design: design('one_page', [{ type: 'question', id: 'quest0000001', item_id: 'i1', points: 1, required: false }]) }));
    const words = screen.getAllByRole('radio').map((option) => option.querySelector('.dv-opt-t')?.textContent);
    expect([...words].sort()).toEqual(['Кремниевая', 'Серная', 'Угольная']);
  });

  it('a quiz without a page is the usual one question at a time', () => {
    run(attempt('one_page', { design: null }));
    expect(document.querySelector('.dv')).toBeNull();
    expect(document.querySelector('.ct-opts')).not.toBeNull();
  });
});

describe('QuizRun «как в студии»: a guest and the pictures, as in the usual attempt', () => {
  const TOKEN = 'A'.repeat(42) + 'g';
  const STEM = `${EXAM}/${'c'.repeat(64)}.png`;

  it('every call with the device’s token; the question’s pictures through quiz-media with it', async () => {
    const pictured = attempt('one_page', { items: [{ ...ITEMS[0], images: { stem: [STEM] } }, ...ITEMS.slice(1)] });
    run(pictured, TOKEN);
    await advance(0);
    expect(api.guestPictureUrl).toHaveBeenCalledWith(STEM, 'att-d', TOKEN);
    expect(api.pictureUrl).not.toHaveBeenCalled();
    expect(document.querySelector('.dv-q img')).toHaveAttribute('src', 'blob:guest');
    fireEvent.click(screen.getByRole('radio', { name: /Серная/ }));
    await advance(SEND_DELAY_MS);
    expect(api.sendAnswers).toHaveBeenCalledWith('att-d', [{ item_id: 'i1', chosen: [1] }], TOKEN);
  });

  it('a page in graphite keeps the dark arrow of the sheet’s pill (the colour named by class too)', () => {
    run(attempt('one_page', { design: { ...design('one_page'), theme: { ...design('one_page').theme, accent: 'graphite' } }, answers: [{ item_id: 'i1', chosen: [0], text: null }, { item_id: 'i3', chosen: null, text: 'да' }] }));
    fireEvent.click(document.querySelector('.ct-rb-exit') as HTMLElement);
    expect(screen.getByRole('dialog', { name: RUN.finishTitle })).toHaveClass('qt-accent', 'qt-design', 'qt-accent-graphite');
  });
});
