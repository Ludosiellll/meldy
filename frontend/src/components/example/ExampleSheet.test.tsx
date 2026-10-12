import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { FROM_TRY } from '../../lib/returnTo';

const mocks = vi.hoisted(() => ({ user: null as null | { id: string } }));

vi.mock('../../lib/supabase', () => ({ supabase: {} }));
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: mocks.user, session: null, loading: false, signOut: vi.fn() }) }));
// The lecture's result is a file of its own: here only whether the sheet asks for it.
const lecturePart = vi.hoisted(() => ({ load: vi.fn(async () => () => null) }));
vi.mock('./tryParts', async (importOriginal) => ({ ...(await importOriginal<typeof import('./tryParts')>()), tryLecturePart: lecturePart }));

import ExampleSheet, { EXAMPLE_ANSWERS_NOTE } from './ExampleSheet';
import ExampleDraw from './ExampleDraw';
import TryBar from './TryBar';
import { TRY_PEAK_KEY, TRY_SHEET_KEY, exampleHash, readTryStore } from './trySheet';

/**
 * The example's sheet around the cheat sheet (w5, PUB-3, 15, 16, 18, 24): the scripted answer to question 5
 * is the page's filled pill until the guest answers, then an exam of their own is; the privacy line is true;
 * the top line's call to sign up follows decision 5. (The whole /try flow is pages/TryExample.test.tsx.)
 */

const plain = (text: string | null | undefined) => (text ?? '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
const width = Object.getOwnPropertyDescriptor(window, 'innerWidth');

function setWidth(px: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: px });
}

function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/try" element={<ExampleSheet />} />
        <Route path="/try/draw" element={<ExampleDraw />} />
        <Route path="/try/ticket" element={<h1>Билет</h1>} />
        <Route path="/register" element={<h1>Регистрация</h1>} />
      </Routes>
    </MemoryRouter>,
  );
}

/** The guest answered question 5 a minute ago (as the answer screen keeps it in this tab), and the sheet plays it. */
function guestAnswered() {
  const store = readTryStore();
  const now = Date.now();
  window.sessionStorage.setItem(
    TRY_SHEET_KEY,
    JSON.stringify({
      ...store,
      answers: [...store.answers, { session: 'guest-1', questionId: 'q5', at: now - 60_000, transcript: 'Эластичность — реакция спроса на цену.', statuses: { p1: 'covered', p2: 'covered', p3: 'covered', p4: 'missing', p5: 'missing' }, followup: null, check: { by: 'ai' } }],
    }),
  );
  window.sessionStorage.setItem(TRY_PEAK_KEY, JSON.stringify([{ hash: exampleHash('q5'), question_id: 'q5' }]));
}

beforeEach(() => {
  mocks.user = null;
  window.sessionStorage.clear();
  window.localStorage.clear();
  setWidth(1532);
});

afterEach(() => {
  cleanup();
  if (width) Object.defineProperty(window, 'innerWidth', width);
  document.title = '';
});

describe('the example’s sheet (/try)', () => {
  it('names the tab, and before the guest answers offers question 5 as the page’s filled pill under the caption', () => {
    renderAt('/try?view=sheet');
    expect(document.title).toBe('Пример экзамена — Meldy');
    const caption = document.querySelector('.tx-sheet-cap') as HTMLElement;
    // The caption says it in words (no link in its lines, «5» held to «вопрос»), the pill under it acts.
    expect(within(caption).queryByRole('link')).toBeNull();
    expect(caption.textContent).toContain('вопрос 5');
    const q5 = screen.getByRole('link', { name: 'Ответить на вопрос 5' });
    expect(q5).toHaveAttribute('href', '/try/ticket?q=q5');
    expect(q5).toHaveClass('sf-primary');
    expect(q5.closest('.tx-sheet-go')?.previousElementSibling).toBe(caption);
    // A random draw rarely gives question 5: «Тянуть билет» is the white pill beside it.
    expect(screen.getByRole('button', { name: 'Тянуть билет' })).toHaveClass('ex-secondary');
    // Nothing is erased yet: the switch says so, with the answer that erases (PUB-16).
    const only = screen.getByRole('switch', { name: 'Скрыть строки, стёртые совсем' });
    expect(only).toHaveAttribute('aria-disabled', 'true');
    expect(only).toHaveAccessibleDescription(/^Таких\sстрок\sпока\sнет:\sответьте\sна\sвопрос\s5$/);
    // No own-exam card before an answer.
    expect(document.querySelector('.cs-next')).toBeNull();
  });

  it('a line’s panel takes the filled pill: question 5 steps down to white', () => {
    renderAt('/try?view=sheet');
    fireEvent.click(document.querySelector<HTMLButtonElement>('#cs-q-q2 .cs-line .cs-lbtn') as HTMLButtonElement);
    expect(screen.getByRole('link', { name: 'Ответить на этот вопрос' })).toHaveClass('sf-primary');
    expect(screen.getByRole('link', { name: 'Ответить на вопрос 5' })).toHaveClass('ex-secondary');
  });

  it('says truly where the answers go (PUB-3), and the draw is the filled pill of «Вопросы»', () => {
    renderAt('/try?view=questions');
    expect(plain(document.querySelector('.tx-privacy')?.textContent)).toBe(EXAMPLE_ANSWERS_NOTE);
    expect(EXAMPLE_ANSWERS_NOTE).toContain('Google Gemini');
    expect(EXAMPLE_ANSWERS_NOTE).not.toContain('не уходят');
    expect(screen.getByRole('button', { name: 'Тянуть билет' })).toHaveClass('sf-primary');
    expect(screen.queryByRole('link', { name: 'Ответить на вопрос 5' })).toBeNull();
  });

  it('after the guest’s answer, an exam of their own is the next step, under what the answer changed (PUB-18)', async () => {
    guestAnswered();
    renderAt('/try?view=sheet');
    const next = await screen.findByText((_, node) => node?.classList.contains('tx-own') === true);
    expect(next.closest('.cs-next')).not.toBeNull();
    expect(plain(within(next).getByText(/^Это был пример/).textContent)).toBe('Это был пример. В своём экзамене вы вставите список вопросов кафедры и добавите свои лекции.');
    const own = within(next).getByRole('link', { name: 'Начать со своего списка' });
    expect(own).toHaveAttribute('href', '/register?next=%2Fexams%2Fnew');
    expect(own).toHaveClass('sf-primary');
    expect(screen.queryByRole('link', { name: 'Ответить на вопрос 5' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Тянуть билет' })).toHaveClass('ex-secondary');
    // «Начать пример заново» brings the scripted answer back, and the keyboard to it.
    vi.useFakeTimers();
    try {
      fireEvent.click(screen.getByRole('button', { name: 'Начать пример заново' }));
      act(() => {
        vi.runOnlyPendingTimers();
      });
      expect(document.activeElement).toBe(screen.getByRole('link', { name: 'Ответить на вопрос 5' }));
    } finally {
      vi.useRealTimers();
    }
  });

  it('a signed-in student is offered a new exam straight away', async () => {
    mocks.user = { id: 'user-1' };
    guestAnswered();
    renderAt('/try?view=sheet');
    const next = await screen.findByText((_, node) => node?.classList.contains('tx-own') === true);
    expect(within(next).getByRole('link', { name: 'Создать свой экзамен' })).toHaveAttribute('href', '/exams/new');
  });

  it('a phone: the step the page is about rides in the bar at the bottom, the random draw a quiet line under it', async () => {
    setWidth(390);
    renderAt('/try?view=sheet');
    const bar = document.querySelector('.ex-cta') as HTMLElement;
    expect(within(bar).getByRole('link', { name: 'Ответить на вопрос 5' })).toHaveClass('sf-primary');
    expect(within(bar).getByRole('button', { name: 'Тянуть случайный билет' })).toHaveClass('sf-link');
    // Not twice: no pill under the caption on a phone.
    expect(screen.getAllByRole('link', { name: 'Ответить на вопрос 5' })).toHaveLength(1);
    cleanup();
    // After an answer: an exam of their own; at 320 px with the short label (decision 5).
    setWidth(320);
    guestAnswered();
    renderAt('/try?view=questions');
    const after = document.querySelector('.ex-cta') as HTMLElement;
    expect(within(after).getByRole('link', { name: 'Создать аккаунт' })).toHaveAttribute('href', '/register?next=%2Fexams%2Fnew');
    expect(within(after).getByRole('button', { name: 'Тянуть ещё билет' })).toBeTruthy();
  });

  it('leads from the lectures to what Meldy made of the first one, and fetches that page when the link is pointed at', () => {
    renderAt('/try');
    const lectures = screen.getByRole('region', { name: 'Лекции примера' });
    const link = within(lectures).getByRole('link', { name: /^Что\sMeldy\sсделал\sиз\sлекции\s«Спрос\sи\sпредложение»$/ });
    expect(link).toHaveAttribute('href', '/try/lecture');
    // Under the section's lead, before the lectures themselves.
    expect(link.closest('.tx-lectures-head')).not.toBeNull();
    // Not fetched with the sheet; pointing at the link does.
    expect(lecturePart.load).not.toHaveBeenCalled();
    fireEvent.pointerEnter(link);
    expect(lecturePart.load).toHaveBeenCalledTimes(1);
  });

  it('the draw names its tab', () => {
    renderAt('/try/draw');
    expect(document.title).toBe('Тянуть билет · пример — Meldy');
  });
});

describe('the top line of /try (decision 5, PUB-24)', () => {
  const bar = (url = '/try') =>
    render(
      <MemoryRouter initialEntries={[url]}>
        <TryBar />
      </MemoryRouter>,
    );

  it('a guest: «Войти» and «Начать со своего списка», which leads through sign-up to a new exam', () => {
    bar();
    const nav = screen.getByRole('navigation', { name: 'Вход и регистрация' });
    expect(within(nav).getByRole('link', { name: 'Войти' })).toHaveAttribute('href', '/login');
    expect(within(nav).getByRole('link', { name: 'Начать со своего списка' })).toHaveAttribute('href', '/register?next=%2Fexams%2Fnew');
  });

  it('where space is short, «Создать аккаунт» — and «Войти» stays, phones included', () => {
    setWidth(320);
    bar();
    const nav = screen.getByRole('navigation', { name: 'Вход и регистрация' });
    expect(within(nav).getByRole('link', { name: 'Войти' })).toBeTruthy();
    expect(within(nav).getByRole('link', { name: 'Создать аккаунт' })).toHaveAttribute('href', '/register?next=%2Fexams%2Fnew');
  });

  it('the call to sign up takes the way back to the example along (the sign-up then offers it)', () => {
    function StateOf() {
      const { state } = useLocation();
      return <p data-testid="state">{JSON.stringify(state)}</p>;
    }
    render(
      <MemoryRouter initialEntries={['/try']}>
        <Routes>
          <Route path="/try" element={<TryBar />} />
          <Route path="/register" element={<StateOf />} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('link', { name: 'Начать со своего списка' }));
    expect(screen.getByTestId('state').textContent).toBe(JSON.stringify(FROM_TRY));
  });

  it('a signed-in student: the way to their exams', () => {
    mocks.user = { id: 'user-1' };
    bar();
    expect(screen.getByRole('link', { name: 'Мои экзамены' })).toHaveAttribute('href', '/exams');
    expect(screen.queryByRole('link', { name: 'Войти' })).toBeNull();
  });
});
