import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import Landing, { EYEBROW, HEADLINE, LEAD, RESULT_NOTE, RESULT_SAMPLE, RESULT_TITLE, SHEET_LEGEND, SIGN_UP_SHORT, START_LABEL, STEPS, TRY_LABEL } from './Landing';
import { REEL_EVENT } from '../components/home/reelJump';
import { SHEET_EXAMPLE, SHEET_REPLAY_EVENT, SHEET_TITLE } from '../components/home/HeroSheet';
import { freePlanLine } from '../components/landing/freePlan';
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
        <Route path="/try" element={<TryStub />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** The example's page, telling which of its views was asked for. */
function TryStub() {
  const { search } = useLocation();
  return <p>Пример экзамена{search ? ` ${search}` : ''}</p>;
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
    const sheet = within(section).getByRole('figure', { name: `${SHEET_TITLE} ${SHEET_EXAMPLE}` });
    expect(SHEET_TITLE).toBe('Шпаргалка, которая исчезает');
    expect(sheet.querySelector('.hs-paper')).toHaveAttribute('aria-hidden', 'true');
    expect(sheet.querySelectorAll('.hs-line').length).toBeGreaterThanOrEqual(4);
    expect(plain(sheet.textContent)).toContain('Микроэкономика · пример');
    expect(plain(section.textContent)).toContain('Строки стирают только ответы');
  });

  it('names the sheet in a heading beside it and explains its three kinds of line, drawn as the paper draws them (audit PUB-12)', () => {
    renderLanding();
    const section = document.getElementById('sheet') as HTMLElement;
    expect(section).toHaveAttribute('aria-labelledby', 'sheet-h');
    expect(plain(within(section).getByRole('heading', { level: 2 }).textContent)).toBe(SHEET_TITLE);
    // The flag no longer repeats the heading: it says which example this is.
    expect(plain(section.querySelector('.hs-flag')?.textContent)).toBe(SHEET_EXAMPLE);
    const items = Array.from(section.querySelectorAll('.hm-legend li'));
    expect(items.map((item) => item.getAttribute('data-state'))).toEqual(['fresh', 'rubbed', 'erased']);
    expect(items.map((item) => plain(item.querySelector('.hm-legend-t')?.textContent))).toEqual(SHEET_LEGEND.map((entry) => `${entry.name}: ${entry.text}`));
    expect(SHEET_LEGEND.map((entry) => entry.name)).toEqual(['Написано', 'Стёрто наполовину', 'Стёрто совсем']);
    // Each state on a strip of the same paper, the line in the sheet's hand; the strips are pictures.
    for (const strip of section.querySelectorAll('.hm-legend-paper')) {
      expect(strip).toHaveAttribute('aria-hidden', 'true');
      expect(plain(strip.textContent)).toBe('выручка = цена × количество');
    }
    expect(plain(section.textContent)).toContain('Не назвали потом — строка вернётся.');
    fireEvent.click(within(section).getByRole('button', { name: TRY_LABEL }));
    expect(screen.getByText('Пример экзамена')).toBeInTheDocument();
  });

  it('offers the example first, then the own list, and says the example needs no account', () => {
    renderLanding();
    const actions = document.querySelector('.hm-hero .hm-acts') as HTMLElement;
    const buttons = within(actions).getAllByRole('button');
    expect(buttons.map((button) => plain(button.textContent))).toEqual([TRY_LABEL, START_LABEL]);
    expect(buttons[0]).toHaveClass('hm-pill--blue');
    expect(buttons[1]).toHaveClass('hm-pill--white');
    expect(plain(document.querySelector('.hm-hero .hm-also')?.textContent)).toBe(`Пример открывается без регистрации. ${plain(freePlanLine())}`);
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
    // Decision 5 of 2026-10-08: sign-up is «Начать со своего списка», «Создать аккаунт» where space is short.
    expect(within(nav).getByRole('button', { name: SIGN_UP_SHORT })).toBeInTheDocument();
    expect(SIGN_UP_SHORT).toBe('Создать аккаунт');
    expect(within(nav).queryByRole('button', { name: 'Начать' })).toBeNull();
    fireEvent.click(within(nav).getByRole('button', { name: SIGN_UP_SHORT }));
    expect(screen.getByText('Страница регистрации')).toBeInTheDocument();
  });

  it('says what the free account gives, from lib/plans.ts, on the first screen (audit PUB-21)', () => {
    renderLanding();
    expect(plain(document.querySelector('.hm-hero .hm-also .hm-free')?.textContent)).toBe(
      'Аккаунт бесплатный: каждый день 100 единиц ИИ — это 5 лекций или 25 проверенных ответов.',
    );
    // The phone's copy of the line, after the video (one of the two is shown, by the width).
    expect(plain(document.querySelector('.hm-hero .hm-free-m')?.textContent)).toBe(plain(freePlanLine()));
  });

  it('orders the sections: first screen with the video, how it works, the cheat sheet, the result and the group, the questions, the method, the final call', () => {
    const { container } = renderLanding();
    expect(sectionNames(container)).toEqual([
      HEADLINE,
      'Как это работает',
      'Шпаргалка, которая исчезает',
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
    // The list is chapter 01; the spoken answer opens chapter 04, before its sheet.
    expect(asked).toEqual(['questions', 'sheet']);

    const replays: Event[] = [];
    const onReplay = (event: Event) => replays.push(event);
    window.addEventListener(SHEET_REPLAY_EVENT, onReplay);
    fireEvent.click(within(how).getByRole('button', { name: /Показать на шпаргалке/ }));
    window.removeEventListener(SHEET_REPLAY_EVENT, onReplay);
    expect(replays).toHaveLength(1);
    expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalled();

    // Step 2 is about the quotes: they are in the example's «Вопросы» view (audit PUB-13).
    fireEvent.click(within(how).getByRole('button', { name: /Открыть пример/ }));
    expect(screen.getByText('Пример экзамена ?view=questions')).toBeInTheDocument();
  });

  it('says that the teacher gives the mark and that a group shares one exam by link', () => {
    renderLanding();
    expect(screen.getByRole('heading', { level: 2, name: RESULT_TITLE })).toBeInTheDocument();
    expect(RESULT_TITLE).toBe('Отметку ставит преподаватель');
    expect(RESULT_NOTE).toBe('Meldy проверяет только, назвали ли вы пункты из своих лекций.');
    expect(plain(document.body.textContent)).toContain(RESULT_NOTE);
    // The sample result in the protocol's words (decision 2 of 2026-10-08), as the card's text says it.
    expect(plain(RESULT_SAMPLE)).toBe('Сами назвали 3 из 4 главных пунктов, ещё 1 — после вопроса экзаменатора');
    expect(plain(document.querySelector('.hm-proto-l')?.textContent)).toBe(plain(RESULT_SAMPLE));
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
