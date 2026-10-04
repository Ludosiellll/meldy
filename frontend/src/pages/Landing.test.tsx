import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import Landing, { HEADLINE, PRIMARY_LABEL, TRY_LABEL } from './Landing';
import { REEL_EVENT } from '../components/home/reelJump';

vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({ user: null }),
}));

class SilentObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}

function stubMatchMedia(reduce = false) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: reduce && query.includes('prefers-reduced-motion'),
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
}

function renderLanding() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/register" element={<p>Страница регистрации</p>} />
        <Route path="/login" element={<p>Страница входа</p>} />
        <Route path="/try" element={<p>Пример экзамена</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

const plain = (s: string | null | undefined) => (s ?? '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();

/** The page's sections in order, each named by the heading it is labelled by (or its aria-label). */
function sectionNames(container: HTMLElement) {
  return Array.from(container.querySelectorAll('main > section')).map((section) => {
    const id = section.getAttribute('aria-labelledby');
    return plain(id ? document.getElementById(id)?.textContent : section.getAttribute('aria-label'));
  });
}

describe('Landing page', () => {
  beforeEach(() => {
    vi.stubGlobal('IntersectionObserver', SilentObserver);
    stubMatchMedia(false);
    vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('opens on the session: the headline with its hand-drawn line, what Meldy does, two actions and the formats', () => {
    renderLanding();
    const h1 = screen.getByRole('heading', { level: 1 });
    expect(plain(h1.textContent)).toBe(HEADLINE);
    expect(h1.querySelector('.hm-mark svg path')).not.toBeNull();
    const lead = plain(document.querySelector('.hm-lead')?.textContent);
    expect(lead).toContain('Вставьте вопросы к экзамену и загрузите лекции.');
    expect(lead).toContain('экзаменатор спросит о том, что вы пропустили');
    expect(screen.getAllByRole('button', { name: new RegExp(PRIMARY_LABEL) })[0]).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Как проходит ответ/ })).toBeInTheDocument();
    expect(Array.from(document.querySelectorAll('.hm-formats b')).map((b) => b.textContent)).toEqual(['PDF', 'DOCX', 'TXT', 'MD', 'Аудио']);
  });

  it('says what the questions are for: exam, credit or colloquium', () => {
    renderLanding();
    const group = screen.getByRole('group', { name: 'К чему готовитесь' });
    expect(within(group).getByRole('button', { name: 'экзамену' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(within(group).getByRole('button', { name: 'зачёту' }));
    expect(within(group).getByRole('button', { name: 'зачёту' })).toHaveAttribute('aria-pressed', 'true');
    expect(plain(document.querySelector('.hm-lead')?.textContent)).toContain('Вставьте вопросы к зачёту');
  });

  it('names the navbar «Ролик · Как это работает · Подход», and every anchor it points to exists', () => {
    const { container } = renderLanding();
    const nav = screen.getByRole('navigation', { name: 'Главное меню' });
    const links = within(nav).getAllByRole('link');
    expect(links.map((a) => a.textContent)).toEqual(['Ролик', 'Как это работает', 'Подход']);
    for (const href of links.map((a) => a.getAttribute('href'))) expect(container.querySelector(href!)).not.toBeNull();
    expect(within(nav).getByRole('button', { name: 'Войти' })).toBeInTheDocument();
    expect(within(nav).getByRole('button', { name: 'Начать' })).toBeInTheDocument();
  });

  it('orders the sections: first screen, the reel, the questions, how it works, the method, the final call', () => {
    const { container } = renderLanding();
    expect(sectionNames(container)).toEqual([
      HEADLINE,
      'Meldy за 35 секунд',
      'Примеры вопросов',
      'От списка вопросов — до ответа вслух',
      'Вспоминать полезнее, чем перечитывать',
      'Начните со списка вопросов',
    ]);
    expect(Array.from(container.querySelectorAll('main > section')).map((s) => s.id)).toEqual(['', 'reel', '', 'how', 'method', 'start']);
  });

  it('shows four parts of the work, each with its flag; three of them open in the reel', () => {
    renderLanding();
    const how = document.getElementById('how')!;
    expect(Array.from(how.querySelectorAll('.hm-flag')).map((f) => f.textContent)).toEqual(['Билеты', 'Ответ вслух', 'Повторение', 'Разговор']);
    expect(within(how).getAllByRole('heading', { level: 3 }).map((h) => plain(h.textContent))).toEqual([
      'Где в лекциях ответ на каждый вопрос',
      'Тяните билет и отвечайте вслух',
      'Что пропустили — вернётся завтра',
      'Лекция голосами двух ведущих',
    ]);
    const asked: string[] = [];
    const listener = (event: Event) => asked.push((event as CustomEvent<{ chapter: string }>).detail.chapter);
    window.addEventListener(REEL_EVENT, listener);
    within(how)
      .getAllByRole('button', { name: /Смотреть в ролике/ })
      .forEach((button) => fireEvent.click(button));
    window.removeEventListener(REEL_EVENT, listener);
    expect(asked).toEqual(['tickets', 'oral', 'review']);
  });

  it('keeps the ticker readable once: the second copy of the loop is hidden from screen readers', () => {
    renderLanding();
    const items = Array.from(document.querySelectorAll('.hm-track li'));
    expect(items).toHaveLength(16);
    expect(items.filter((li) => li.getAttribute('aria-hidden') === 'true')).toHaveLength(8);
  });

  it('under reduced motion lists each question once and does not loop', () => {
    stubMatchMedia(true);
    renderLanding();
    expect(document.querySelectorAll('.hm-track li')).toHaveLength(8);
  });

  it('starts with the list of questions from the first screen and from the final call', () => {
    renderLanding();
    const [first, last] = screen.getAllByRole('button', { name: new RegExp(PRIMARY_LABEL) });
    expect(first).toBeDefined();
    expect(last).toBeDefined();
    fireEvent.click(last);
    expect(screen.getByText('Страница регистрации')).toBeInTheDocument();
  });

  it('offers the example exam next to the main action, with no account needed', () => {
    renderLanding();
    const actions = document.querySelector('.hm-hero .hm-acts') as HTMLElement;
    const buttons = within(actions).getAllByRole('button');
    expect(buttons.map((button) => plain(button.textContent))).toEqual([PRIMARY_LABEL, TRY_LABEL]);
    expect(buttons[1]).toHaveClass('hm-pill--white');
    fireEvent.click(buttons[1]);
    expect(screen.getByText('Пример экзамена')).toBeInTheDocument();
  });

  it('signs in from the navbar on every width', () => {
    renderLanding();
    fireEvent.click(screen.getByRole('button', { name: 'Войти' }));
    expect(screen.getByText('Страница входа')).toBeInTheDocument();
  });

  it('asks the reel for the oral chapter from «Как проходит ответ»', () => {
    renderLanding();
    const asked: string[] = [];
    const listener = (event: Event) => asked.push((event as CustomEvent<{ chapter: string }>).detail.chapter);
    window.addEventListener(REEL_EVENT, listener);
    fireEvent.click(screen.getByRole('button', { name: /Как проходит ответ/ }));
    window.removeEventListener(REEL_EVENT, listener);
    expect(asked).toEqual(['oral']);
    expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalled();
  });

  it('tells the method in three cards, without numbers it cannot back', () => {
    renderLanding();
    const method = document.getElementById('method')!;
    expect(Array.from(method.querySelectorAll('.hm-tint-k')).map((k) => k.textContent)).toEqual(['Сначала вопрос', 'Потом — реже', 'Готовность']);
    expect(method.textContent).not.toMatch(/\d+\s?%/);
  });
});
