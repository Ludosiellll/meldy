import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import FlashcardsView from './FlashcardsView';

const TAB = '\u0009';

const DATA = {
  flashcards: [
    { id: 1, question: 'Что такое первичный ключ? [S01]', answer: 'Атрибут, который однозначно определяет строку.', source_ids: ['S01'] },
    // Stored by the old server: «\text» lost its backslash to the JSON escape «\t».
    { id: 2, question: `Что считает $${TAB}ext{COUNT}(x)$?`, answer: `Число строк, где $x$ не NULL: $${TAB}ext{COUNT}(x) \\le n$.`, source_ids: [] },
  ],
} as never;

function renderCards(props: Partial<Parameters<typeof FlashcardsView>[0]> = {}) {
  return render(
    <MemoryRouter>
      <FlashcardsView data={DATA} {...props} />
    </MemoryRouter>,
  );
}

afterEach(cleanup);

// jsdom cannot compute an accessible name across KaTeX's MathML (its <math> has no style object), so on these
// cards the controls are found by their text, not by role and name.
const link = (text: string) => screen.queryByText(text)?.closest('a') ?? null;
const button = (text: string) => screen.queryByText(text)?.closest('button') ?? null;

describe('the cards of a lecture', () => {
  it('lead to the lecture’s review, not to a deck that saves nothing (finding LIB-10)', () => {
    renderCards({ reviewHref: '/review?material=m1' });
    expect(link('Повторить карточки')).toHaveAttribute('href', '/review?material=m1');
    expect(screen.queryByText(/Начать обучение|Пролистать/)).not.toBeInTheDocument();
    expect(screen.queryByText(/не сохраняются/)).not.toBeInTheDocument();
  });

  it('say how many cards the review has with the ones from ticket answers (finding LIB-6)', () => {
    renderCards({ reviewHref: '/review?material=m1', followups: 4 });
    expect(screen.getByText('В повторении: 2 карточки · ещё 4 из ответов на билеты.')).toBeInTheDocument();
  });

  it('of a result not in the library can only be leafed through, and say so', () => {
    renderCards();
    expect(link('Повторить карточки')).toBeNull();
    expect(screen.getByText('Ответы здесь не сохраняются и не двигают повторение.')).toBeInTheDocument();
    fireEvent.click(button('Пролистать без записи') as HTMLButtonElement);
    expect(document.querySelector('.fc-big-q')?.textContent).toBe('Что такое первичный ключ?');
  });

  it('are numbered «1.», without «Q1:» or the fragment marks (finding LIB-16)', () => {
    renderCards({ reviewHref: '/review?material=m1' });
    const questions = Array.from(document.querySelectorAll('.fc-q'));
    expect(questions.map((question) => question.querySelector('.fc-n')?.textContent)).toEqual(['1.', '2.']);
    expect(questions[0].textContent).toBe('1. Что такое первичный ключ?');
    expect(document.body.textContent).not.toMatch(/Q\d+:|\[S01\]/);
  });

  it('show a formula the old server stored without its backslash as a formula (finding LIB-2)', () => {
    renderCards({ reviewHref: '/review?material=m1' });
    const question = document.querySelectorAll('.fc-q')[1] as HTMLElement;
    expect(question.querySelector('.katex')).not.toBeNull();
    // The text a reader sees, without KaTeX's own copy of the source for screen readers.
    const shown = Array.from(question.querySelectorAll('.katex-html')).map((node) => node.textContent).join('');
    expect(shown).toContain('COUNT');
    expect(shown).not.toContain('ext');
    expect(question.textContent).not.toContain(TAB);

    fireEvent.click(question);
    const answer = document.querySelector('.fc-card[data-open] .fc-answer-wrap') as HTMLElement;
    expect(answer.querySelectorAll('.katex').length).toBeGreaterThanOrEqual(2);
    expect(answer.textContent).not.toContain(TAB);
  });

  it('copy as «Вопрос:» and «Ответ:»', () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    renderCards({ reviewHref: '/review?material=m1' });
    fireEvent.click(document.querySelector('button[aria-label="Скопировать карточку"]') as HTMLButtonElement);
    expect(writeText).toHaveBeenCalledWith('Вопрос: Что такое первичный ключ?\nОтвет: Атрибут, который однозначно определяет строку.');
  });

  it('open a card’s fragment in the panel: the card does not grow and its answer stays closed (owner 21.10)', () => {
    const sources = [{ id: 'S01', text: 'Первичный ключ — атрибут, который однозначно определяет строку таблицы.' }];
    renderCards({ reviewHref: '/review?material=m1', sources });
    const card = document.querySelector('.fc-card') as HTMLElement;
    fireEvent.click(card.querySelector('button[aria-label="Ближайшие фрагменты лекции: 1"]') as HTMLButtonElement);
    const panel = document.querySelector('[role="dialog"]') as HTMLElement;
    expect(panel).toHaveAttribute('aria-label', 'Фрагмент 1 лекции');
    expect(card.querySelector('.sf-slip')).toBeNull();
    expect(panel.textContent).toContain('Здесь в лекции больше всего общих слов с карточкой.');
    // The words the card shares with the fragment are underlined.
    expect(Array.from(panel.querySelectorAll('.sf-under')).map((mark) => mark.textContent)).toContain('однозначно');
    // A click in the panel is not a click on the card: the answer stays closed.
    fireEvent.click(panel.querySelector('.fp-slip') as HTMLElement);
    fireEvent.click(document.querySelector('.fp-dim') as HTMLElement);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(card).not.toHaveAttribute('data-open');
  });
});

describe('owner 21.10: a reload of the lecture page keeps the place in «Карточки»', () => {
  const brought: string[] = [];
  const opened = () => Array.from(document.querySelectorAll('.fc-card')).map((card) => card.hasAttribute('data-open'));
  beforeEach(() => {
    brought.length = 0;
    window.sessionStorage.clear();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value(this: HTMLElement) {
        brought.push(this.querySelector('.fc-n')?.textContent ?? '');
      },
    });
  });
  afterEach(() => {
    delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    window.history.replaceState(null, '', '/');
  });

  it('the card on screen (?card=) comes back into view and the answers opened in this tab stay open', () => {
    window.history.replaceState(null, '', '/library/m1?section=flashcards&card=2');
    const first = renderCards({ reviewHref: '/review?material=m1', placeKey: 'm1' });
    expect(brought).toEqual(['2.']);
    fireEvent.click(document.querySelectorAll('.fc-q')[0]);
    expect(opened()).toEqual([true, false]);
    first.unmount();

    renderCards({ reviewHref: '/review?material=m1', placeKey: 'm1' });
    expect(brought).toEqual(['2.', '2.']);
    expect(opened()).toEqual([true, false]);
    fireEvent.click(button('Скрыть все') as HTMLButtonElement);
    expect(window.sessionStorage.length).toBe(0);
  });

  it('elsewhere (a result not on the lecture page) nothing is kept', () => {
    window.history.replaceState(null, '', '/analyze?card=2');
    const first = renderCards({ reviewHref: '/review?material=m1' });
    fireEvent.click(document.querySelectorAll('.fc-q')[0]);
    first.unmount();
    renderCards({ reviewHref: '/review?material=m1' });
    expect(brought).toEqual([]);
    expect(opened()).toEqual([false, false]);
    expect(window.sessionStorage.length).toBe(0);
  });
});
