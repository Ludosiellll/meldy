import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import Landing, { EXAM_TITLE_H, EYEBROW, FINAL_LEAD, HEADLINE, LECTURE_EXAMPLE_LINE, LEAD, METHOD, RESULT_NOTE, RESULT_SAMPLE, RESULT_TITLE, SIGN_UP_SHORT, START_LABEL, STEPS, TRY_LABEL } from './Landing';
import { REEL_EVENT } from '../components/home/reelJump';
import { SHEET_EXAMPLE, SHEET_REPLAY_EVENT, SHEET_TITLE } from '../components/home/HeroSheet';
import { freePlanLine } from '../components/landing/freePlan';
import { OUTRO_CTA_LABEL } from '../components/reel/scenes/Outro';
import { TOTAL } from '../components/reel/timeline';
import { EXAM_TITLE, IMPORT_WORDS, INVITE_WORDS, ORAL_SHEET_ROW, SUBJECTS, exampleWords, localToday, subjectRow } from '../data/containerExample';
import { RULE_LINE } from '../lib/containers/words';
import { howCounted } from '../components/containers/copy';
import { DUE_DAYS } from '../lib/containers/rule';

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
        <Route path="/try/lecture" element={<p>Разбор лекции примера</p>} />
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

/** The page's own sections: everything but the reel (another file tells its story). */
function ownText(container: HTMLElement) {
  const clone = container.cloneNode(true) as HTMLElement;
  clone.querySelector('#reel')?.remove();
  return plain(clone.textContent);
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

  it('opens on the promise: what Meldy is, the headline with its hand-drawn line, and the exam as it is now', () => {
    renderLanding();
    expect(plain(document.querySelector('.hm-eyebrow')?.textContent)).toBe(EYEBROW);
    expect(EYEBROW).toBe('Тренажёр экзамена по вопросам кафедры');
    const h1 = screen.getByRole('heading', { level: 1 });
    expect(plain(h1.textContent)).toBe(HEADLINE);
    expect(HEADLINE).toBe('ИИ не отвечает за вас — он вас спрашивает');
    expect(plain(h1.querySelector('.hm-mark')?.textContent)).toBe('спрашивает');
    expect(h1.querySelector('.hm-mark svg path')).not.toBeNull();
    expect(plain(document.querySelector('.hm-hero .hm-lead')?.textContent)).toBe(LEAD);
    // The import's own words (one file or one per subject), the plan by days, the oral questions against the lectures.
    expect(LEAD).toContain('один файл или по файлу на предмет');
    expect(LEAD).toContain('по дням до экзамена');
    expect(LEAD).toContain('устные спросит вслух и сверит с вашими лекциями');
    expect(LEAD).not.toMatch(/шпаргалк/i);
  });

  it('shows one exam for the whole preparation below how it works: the example\'s page and its oral subject\'s sheet', () => {
    const { container } = renderLanding();
    const section = document.getElementById('exam') as HTMLElement;
    expect(document.querySelector('.hm-hero')?.contains(section)).toBe(false);
    expect(section).toHaveAttribute('aria-labelledby', 'exam-h');
    expect(plain(within(section).getByRole('heading', { level: 2 }).textContent)).toBe(EXAM_TITLE_H);
    // Under the heading, the plan's own lines for the example: what the minutes reach by the date, and the rule.
    const words = exampleWords(localToday());
    expect(plain(section.querySelector('.hm-sub')?.textContent)).toBe(plain(`${words.need} ${RULE_LINE}`));
    // The exam's page: its name, meta, today's step, the figure and every subject's row, the oral one with its sheet.
    const page = section.querySelector('.hx') as HTMLElement;
    expect(plain(page.querySelector('.hx-h')?.textContent)).toBe(EXAM_TITLE);
    expect(plain(page.querySelector('.hx-meta')?.textContent)).toBe(plain(words.meta));
    expect(plain(page.querySelector('.hx-plan-t')?.textContent)).toBe(plain(words.planTitle));
    expect(Array.from(page.querySelectorAll('.hx-rows li')).map((row) => plain(row.textContent))).toEqual(
      SUBJECTS.map((subject) => plain(`${subject.title}${subjectRow(subject)}${subject.oral ? ORAL_SHEET_ROW : ''}`)),
    );
    expect(page.querySelector('.hx-pic')).toHaveAttribute('aria-hidden', 'true');
    expect(plain(page.querySelector('figcaption')?.textContent)).toContain(EXAM_TITLE);
    // The sheet, in Meldy's own look.
    const sheet = within(section).getByRole('figure', { name: SHEET_TITLE });
    expect(plain(sheet.textContent)).toContain(SHEET_EXAMPLE);
    expect(sheet.querySelectorAll('.hs-line').length).toBeGreaterThanOrEqual(4);
    expect(sheet.querySelectorAll('.hs-map > i').length).toBeGreaterThan(40);
    fireEvent.click(within(section).getByRole('button', { name: TRY_LABEL }));
    expect(screen.getByText('Пример экзамена')).toBeInTheDocument();
    expect(container).toBeTruthy();
  });

  it('draws no paper: no squared sheet, handwriting, pencil or eraser anywhere on the page', () => {
    const { container } = renderLanding();
    expect(container.querySelector('.hs-paper, .hm-legend-paper, .hm-eraser, .hs-patch, .hs-tick, .cs-arrow-ink, .sf-under-ink')).toBeNull();
    expect(ownText(container)).not.toMatch(/в клетку|ластик|карандаш|пустая шпаргалка|пустой шпаргалки/i);
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

  it('orders the sections: first screen with the video, how it works, the exam, the result and the group, the questions, the method, the final call', () => {
    const { container } = renderLanding();
    expect(sectionNames(container)).toEqual([
      HEADLINE,
      'Как это работает',
      EXAM_TITLE_H,
      'Итог и группа',
      'Примеры вопросов',
      'Вспоминать полезнее, чем перечитывать',
      'Начните со списка вопросов',
    ]);
    expect(Array.from(container.querySelectorAll('main > section')).map((s) => s.id)).toEqual(['', 'how', 'exam', '', '', 'method', 'start']);
    // The video is on the first screen, inside the hero, right after the text (the owner, 2026-10-08).
    expect(container.querySelector('.hm-hero .hm-hero-reel #reel')).not.toBeNull();
  });

  it('names the reel by its real length, and its end card calls to the example in the hero button’s words', () => {
    renderLanding();
    expect(screen.getByRole('heading', { name: `Meldy за ${Math.round(TOTAL / 1000)} секунд` })).toBeInTheDocument();
    expect(OUTRO_CTA_LABEL).toBe(TRY_LABEL);
  });

  it('tells how it works in four numbered steps, in the order of the work: the file, the plan, the answer aloud, the sheet', () => {
    renderLanding();
    const how = document.getElementById('how')!;
    const steps = within(how).getAllByRole('listitem').filter((item) => item.classList.contains('hm-step'));
    expect(steps).toHaveLength(4);
    expect(Array.from(how.querySelectorAll('.hm-flag')).map((flag) => plain(flag.textContent))).toEqual([
      '1Вопросы',
      '2План по дням',
      '3Ответ вслух',
      '4Шпаргалка',
    ]);
    expect(within(how).getAllByRole('heading', { level: 3 }).map((h) => plain(h.textContent))).toEqual(STEPS.map((step) => plain(step.title)));
    expect(STEPS.map((step) => step.title)).toEqual([
      'Вопросы — из файла кафедры',
      'Каждый день — занятие по плану',
      'Устные — вслух, по вашим лекциям',
      'Строки стирают только ответы в разные дни',
    ]);
    expect(plain(how.textContent)).toContain('Кнопки «знаю» нет');
    // The pictures: what the import found, «План по дням», the ticket, the sheet without paper.
    expect(plain(how.querySelector('.hm-doc-h')?.textContent)).toBe(plain(IMPORT_WORDS.found));
    expect(Array.from(how.querySelectorAll('.hm-days-r')).map((row) => plain(row.textContent))).toEqual(exampleWords(localToday()).days.map(plain));
    expect(how.querySelectorAll('.hm-mini-l')).toHaveLength(3);
    expect(Array.from(how.querySelectorAll('.hm-mini-l')).map((line) => line.getAttribute('data-look'))).toEqual(['gone', 'once', 'left']);
  });

  it('opens the reel at the list, the plan and the answer, and replays the sheet from its step', () => {
    renderLanding();
    const how = document.getElementById('how')!;
    const asked: string[] = [];
    const listener = (event: Event) => asked.push((event as CustomEvent<{ chapter: string }>).detail.chapter);
    window.addEventListener(REEL_EVENT, listener);
    within(how)
      .getAllByRole('button', { name: /Смотреть в ролике/ })
      .forEach((button) => fireEvent.click(button));
    window.removeEventListener(REEL_EVENT, listener);
    // The list is chapter 01, the plan chapter 02; the spoken answer opens chapter 04, before its sheet.
    expect(asked).toEqual(['questions', 'plan', 'sheet']);

    const replays: Event[] = [];
    const onReplay = (event: Event) => replays.push(event);
    window.addEventListener(SHEET_REPLAY_EVENT, onReplay);
    fireEvent.click(within(how).getByRole('button', { name: /Показать на шпаргалке/ }));
    window.removeEventListener(SHEET_REPLAY_EVENT, onReplay);
    expect(replays).toHaveLength(1);
    expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalled();
  });

  it('says that the teacher gives the mark and that a group shares one exam by link, with the plan in Telegram', () => {
    renderLanding();
    expect(screen.getByRole('heading', { level: 2, name: RESULT_TITLE })).toBeInTheDocument();
    expect(RESULT_TITLE).toBe('Отметку ставит преподаватель');
    expect(RESULT_NOTE).toBe('Meldy проверяет только, назвали ли вы пункты из своих лекций.');
    expect(plain(document.body.textContent)).toContain(RESULT_NOTE);
    // The sample result in the protocol's words (decision 2 of 2026-10-08), as the card's text says it.
    expect(plain(RESULT_SAMPLE)).toBe('Сами назвали 3 из 4 главных пунктов, ещё 1 — после вопроса экзаменатора');
    expect(plain(document.querySelector('.hm-proto-l')?.textContent)).toBe(plain(RESULT_SAMPLE));
    const group = screen.getByRole('heading', { level: 2, name: 'Одна ссылка на всю группу' }).closest('article')!;
    // The text for the group's chat is «Пригласить группу»'s own; no «копия» of an exam (spec §16 #52).
    expect(plain(group.querySelector('.hm-chat p')?.textContent)).toBe(plain(INVITE_WORDS.lead));
    expect(plain(group.textContent)).toContain('каждый получит весь экзамен');
    expect(plain(group.textContent)).toContain('Ответы и прогресс у каждого свои');
    expect(plain(group.textContent)).toContain('Telegram');
    expect(plain(group.textContent)).not.toMatch(/копи/i);
  });

  it('keeps no promise the product dropped: no grades, no «засчитано», no podcast hosts, no old tagline', () => {
    const { container } = renderLanding();
    const text = ownText(container);
    expect(text).toMatch(/шпаргалк/i);
    expect(text).not.toMatch(/засчит/i);
    // A grade «5 · отлично», not a count «3 из 12 · сегодня 4» or «в счёте 3 · сегодня 4».
    expect(text).not.toMatch(/отлично|удовлетвор|оценка [2-5]|(?<!\d|счёте\s)[2-5] · /i);
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

  it('offers the example again in the final call, and says what to start with in the import\'s words', () => {
    renderLanding();
    const final = document.getElementById('start')!;
    expect(plain(final.querySelector('.hm-lead')?.textContent)).toBe(plain(FINAL_LEAD));
    expect(FINAL_LEAD).toContain('Один общий файл или по файлу на предмет');
    const buttons = within(final).getAllByRole('button');
    expect(buttons.map((button) => plain(button.textContent))).toEqual([START_LABEL, TRY_LABEL]);
    fireEvent.click(buttons[1]);
    expect(screen.getByText('Пример экзамена')).toBeInTheDocument();
  });

  it('leads from the final call, in one plain line, to what Meldy made of the example’s lecture', () => {
    renderLanding();
    const final = document.getElementById('start')!;
    const line = within(final).getByRole('link');
    expect(plain(line.textContent)).toBe(plain(LECTURE_EXAMPLE_LINE));
    expect(LECTURE_EXAMPLE_LINE).toBe('Что Meldy делает из лекции — пример разбора');
    expect(line).toHaveAttribute('href', '/try/lecture');
    fireEvent.click(line);
    expect(screen.getByText('Разбор лекции примера')).toBeInTheDocument();
  });

  it('signs in from the navbar', () => {
    renderLanding();
    fireEvent.click(screen.getByRole('button', { name: 'Войти' }));
    expect(screen.getByText('Страница входа')).toBeInTheDocument();
  });

  it('tells the method in three cards by the exam\'s own rule, without percentages it cannot back', () => {
    renderLanding();
    const method = document.getElementById('method')!;
    expect(Array.from(method.querySelectorAll('.hm-tint-k')).map((k) => k.textContent)).toEqual(['Сначала вопрос', 'Потом — реже', 'Разные дни']);
    expect(method.textContent).not.toMatch(/\d+\s?%/);
    // «Как считается» of the exam: the intervals of the rule and its two different days, 20 hours apart.
    const rule = howCounted(DUE_DAYS).map(plain);
    expect(plain(METHOD[1].p)).toBe(rule[2]);
    expect(rule[0]).toContain(plain(METHOD[2].p.replace('Поэтому в счёт', 'В счёт').replace(/\.$/, '')));
    expect(plain(method.textContent)).not.toMatch(/строк/i);
  });
});
