import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import Landing, { EYEBROW, HEADLINE, LEAD, RESULT_NOTE, RESULT_TITLE, START_LABEL, STEPS, TRY_LABEL } from './Landing';
import { REEL_EVENT } from '../components/home/reelJump';
import { SHEET_REPLAY_EVENT, SHEET_TITLE } from '../components/home/HeroSheet';
import { OUTRO_CTA_LABEL } from '../components/reel/scenes/Outro';
import { TOTAL } from '../components/reel/timeline';

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

  it('opens on the promise: what Meldy is, the headline with its hand-drawn line, the lead', () => {
    renderLanding();
    expect(plain(document.querySelector('.hm-eyebrow')?.textContent)).toBe(EYEBROW);
    expect(EYEBROW).toBe('Тренажёр устного экзамена по билетам кафедры');
    const h1 = screen.getByRole('heading', { level: 1 });
    expect(plain(h1.textContent)).toBe(HEADLINE);
    expect(HEADLINE).toBe('ИИ не отвечает за вас — он вас спрашивает');
    expect(plain(h1.querySelector('.hm-mark')?.textContent)).toBe('спрашивает');
    expect(h1.querySelector('.hm-mark svg path')).not.toBeNull();
    expect(plain(document.querySelector('.hm-hero .hm-lead')?.textContent)).toBe(LEAD);
    expect(LEAD).toContain('список вопросов кафедры');
    expect(LEAD).toContain('спросит билет вслух и переспросит');
  });

  it('shows the vanishing cheat sheet below how it works, with its rule in words', () => {
    renderLanding();
    // Below «Как это работает» (the owner, 2026-10-08): the video is on the first screen, the sheet is not.
    const section = document.getElementById('sheet') as HTMLElement;
    expect(document.querySelector('.hm-hero')?.contains(section)).toBe(false);
    const sheet = within(section).getByRole('figure', { name: SHEET_TITLE });
    expect(SHEET_TITLE).toBe('Шпаргалка, которая исчезает');
    expect(sheet.querySelector('.hs-paper')).toHaveAttribute('aria-hidden', 'true');
    expect(sheet.querySelectorAll('.hs-line').length).toBeGreaterThanOrEqual(4);
    expect(plain(sheet.textContent)).toContain('Микроэкономика · пример');
    expect(plain(sheet.querySelector('figcaption')?.textContent)).toContain('Строки стирают только ответы');
  });

  it('offers the example first, then the own list, and says the example needs no account', () => {
    renderLanding();
    const actions = document.querySelector('.hm-hero .hm-acts') as HTMLElement;
    const buttons = within(actions).getAllByRole('button');
    expect(buttons.map((button) => plain(button.textContent))).toEqual([TRY_LABEL, START_LABEL]);
    expect(buttons[0]).toHaveClass('hm-pill--blue');
    expect(buttons[1]).toHaveClass('hm-pill--white');
    expect(plain(document.querySelector('.hm-hero .hm-also')?.textContent)).toBe('Пример открывается без регистрации.');
    fireEvent.click(buttons[0]);
    expect(screen.getByText('Пример экзамена')).toBeInTheDocument();
  });

  it('names the navbar «Как это работает · Ролик · Подход», and every anchor it points to exists', () => {
    const { container } = renderLanding();
    const nav = screen.getByRole('navigation', { name: 'Главное меню' });
    const links = within(nav).getAllByRole('link');
    expect(links.map((a) => a.textContent)).toEqual(['Как это работает', 'Ролик', 'Подход']);
    for (const href of links.map((a) => a.getAttribute('href'))) expect(container.querySelector(href!)).not.toBeNull();
    expect(within(nav).getByRole('button', { name: 'Войти' })).toBeInTheDocument();
    expect(within(nav).getByRole('button', { name: 'Начать' })).toBeInTheDocument();
  });

  it('orders the sections: first screen with the video, how it works, the cheat sheet, the result and the group, the questions, the method, the final call', () => {
    const { container } = renderLanding();
    expect(sectionNames(container)).toEqual([
      HEADLINE,
      'Как это работает',
      'Шпаргалка',
      'Итог и группа',
      'Примеры вопросов',
      'Вспоминать полезнее, чем перечитывать',
      'Начните со списка вопросов',
    ]);
    expect(Array.from(container.querySelectorAll('main > section')).map((s) => s.id)).toEqual(['', 'how', 'sheet', '', '', 'method', 'start']);
    // The video is on the first screen, inside the hero, right after the text (the owner, 2026-10-08).
    expect(container.querySelector('.hm-hero .hm-hero-reel #reel')).not.toBeNull();
  });

  it('names the reel by its real length, and its end card calls to the example in the hero button’s words', () => {
    renderLanding();
    expect(screen.getByRole('heading', { name: `Meldy за ${Math.round(TOTAL / 1000)} секунд` })).toBeInTheDocument();
    expect(OUTRO_CTA_LABEL).toBe(TRY_LABEL);
  });

  it('tells how it works in the four steps of the promise, in their order and numbered', () => {
    renderLanding();
    const how = document.getElementById('how')!;
    const steps = within(how).getAllByRole('listitem').filter((item) => item.classList.contains('hm-step'));
    expect(steps).toHaveLength(4);
    expect(Array.from(how.querySelectorAll('.hm-flag')).map((flag) => plain(flag.textContent))).toEqual([
      '1Список кафедры',
      '2Ваши лекции',
      '3Ответ вслух',
      '4Шпаргалка',
    ]);
    expect(within(how).getAllByRole('heading', { level: 3 }).map((h) => plain(h.textContent))).toEqual(STEPS.map((step) => step.title));
    expect(STEPS.map((step) => step.title)).toEqual([
      'Вопросы — из списка вашей кафедры',
      'Ответы — цитатами из ваших лекций',
      'Билет — вслух, с переспросом',
      'Строки стирают только ответы в разные дни',
    ]);
    expect(plain(how.textContent)).toContain('Кнопки «знаю» нет.');
  });

  it('opens the reel at the list and at the answer, the example from the lectures step, and replays the sheet from its step', () => {
    renderLanding();
    const how = document.getElementById('how')!;
    const asked: string[] = [];
    const listener = (event: Event) => asked.push((event as CustomEvent<{ chapter: string }>).detail.chapter);
    window.addEventListener(REEL_EVENT, listener);
    within(how)
      .getAllByRole('button', { name: /Смотреть в ролике/ })
      .forEach((button) => fireEvent.click(button));
    window.removeEventListener(REEL_EVENT, listener);
    expect(asked).toEqual(['tickets', 'oral']);

    const replays: Event[] = [];
    const onReplay = (event: Event) => replays.push(event);
    window.addEventListener(SHEET_REPLAY_EVENT, onReplay);
    fireEvent.click(within(how).getByRole('button', { name: /Показать на шпаргалке/ }));
    window.removeEventListener(SHEET_REPLAY_EVENT, onReplay);
    expect(replays).toHaveLength(1);
    expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalled();

    fireEvent.click(within(how).getByRole('button', { name: /Открыть пример/ }));
    expect(screen.getByText('Пример экзамена')).toBeInTheDocument();
  });

  it('says that the teacher gives the mark and that a group shares one exam by link', () => {
    renderLanding();
    expect(screen.getByRole('heading', { level: 2, name: RESULT_TITLE })).toBeInTheDocument();
    expect(RESULT_TITLE).toBe('Отметку ставит преподаватель');
    expect(RESULT_NOTE).toBe('Meldy проверяет только, назвали ли вы пункты из своих лекций.');
    expect(plain(document.body.textContent)).toContain(RESULT_NOTE);
    const group = screen.getByRole('heading', { level: 2, name: 'Одна ссылка на всю группу' }).closest('article')!;
    expect(plain(group.textContent)).toContain('У каждого будет своя копия');
    expect(plain(group.textContent)).toContain('Ответы каждого видит только он сам.');
  });

  it('keeps no promise the product dropped: no grades, no «засчитано», no podcast hosts, no old tagline', () => {
    renderLanding();
    const text = plain(document.body.textContent);
    expect(text).toMatch(/шпаргалк/i);
    expect(text).not.toMatch(/засчит/i);
    expect(text).not.toMatch(/отлично|удовлетвор|оценка [2-5]|[2-5] · /i);
    expect(text).not.toMatch(/двух ведущих|Макс и Софья|подкаст/i);
    expect(text).not.toMatch(/Конспекты, карточки и тесты|помощник для учёбы/i);
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

  it('starts with the own list from the first screen and from the final call', () => {
    renderLanding();
    const starts = screen.getAllByRole('button', { name: new RegExp(START_LABEL) });
    expect(starts).toHaveLength(2);
    fireEvent.click(starts[1]);
    expect(screen.getByText('Страница регистрации')).toBeInTheDocument();
  });

  it('offers the example again in the final call', () => {
    renderLanding();
    const final = document.getElementById('start')!;
    const buttons = within(final).getAllByRole('button');
    expect(buttons.map((button) => plain(button.textContent))).toEqual([START_LABEL, TRY_LABEL]);
    fireEvent.click(buttons[1]);
    expect(screen.getByText('Пример экзамена')).toBeInTheDocument();
  });

  it('signs in from the navbar', () => {
    renderLanding();
    fireEvent.click(screen.getByRole('button', { name: 'Войти' }));
    expect(screen.getByText('Страница входа')).toBeInTheDocument();
  });

  it('tells the method in three cards, without percentages it cannot back', () => {
    renderLanding();
    const method = document.getElementById('method')!;
    expect(Array.from(method.querySelectorAll('.hm-tint-k')).map((k) => k.textContent)).toEqual(['Сначала вопрос', 'Потом — реже', 'Разные дни']);
    expect(method.textContent).not.toMatch(/\d+\s?%/);
    expect(plain(method.textContent)).toContain('Через 5 дней');
  });
});
