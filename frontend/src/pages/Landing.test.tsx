import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import Landing from './Landing';

vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({ user: null }),
}));

class SilentObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() { return []; }
}

function stubMatchMedia(reduce = false) {
  vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
    matches: reduce && query.includes('prefers-reduced-motion'),
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })));
}

function renderLanding() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/register" element={<p>Страница регистрации</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

const FORMATS = /PDF, DOCX, TXT, MD или\sаудио/g;
const plain = (s: string | null | undefined) => (s ?? '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
const PRIMARY = 'Начать со списка вопросов';
const HEADLINE = 'Сессия начинается со списка вопросов';

/** The page's sections in order, each named by the heading it is labelled by. */
function sectionNames(container: HTMLElement) {
  return Array.from(container.querySelectorAll('main > section')).map(section => {
    const id = section.getAttribute('aria-labelledby');
    return plain(id ? document.getElementById(id)?.textContent : '');
  });
}

/** A top-level section by its heading text (NBSPs of the typesetting read as spaces). */
function section(container: HTMLElement, heading: string) {
  const found = Array.from(container.querySelectorAll<HTMLElement>('main > section')).find(s => {
    const id = s.getAttribute('aria-labelledby');
    return plain(id ? document.getElementById(id)?.textContent : '') === heading;
  });
  if (!found) throw new Error(`no section «${heading}»`);
  return found;
}

/**
 * Text a sighted visitor reads, block by block: screen-reader-only copies, live regions and the
 * slip (the same paper as the sentence it was cut from) are left out.
 */
function visibleBlocks(root: HTMLElement) {
  const blocks: string[] = [];
  const walk = (el: Element) => {
    // CTA labels repeat by design (hero and final call); they are not copy.
    if (el.matches('.sr-only, [aria-live], .ph-strip-pos, .sf-primary, script, style, svg')) return;
    const own = Array.from(el.childNodes).filter(n => n.nodeType === Node.TEXT_NODE).map(n => n.textContent ?? '').join('');
    const isBlock = el.matches('p, h1, h2, h3, li, button, figcaption, dd, dt') || /\S/.test(own);
    if (isBlock && el.matches('p, h1, h2, h3, button, dd, dt')) {
      blocks.push(plain(el.textContent ?? ''));
      return;
    }
    for (const child of Array.from(el.children)) walk(child);
  };
  walk(root);
  return blocks.filter(Boolean);
}

const sentences = (blocks: string[]) => blocks.flatMap(b => b.split(/(?<=[.!?…])\s+/)).map(s => s.trim()).filter(s => s.length > 24);

describe('Landing page', () => {
  beforeEach(() => {
    vi.stubGlobal('IntersectionObserver', SilentObserver);
    stubMatchMedia(false);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    window.sessionStorage.clear();
  });

  it('opens on the session: the headline, what Meldy does with the list and the lectures, and the scene', () => {
    const { container } = renderLanding();
    const heading = screen.getByRole('heading', { level: 1 });
    expect(plain(heading.textContent)).toBe(HEADLINE);
    const hero = section(container, HEADLINE);
    expect(plain(hero.querySelector('.sf-description')?.textContent)).toBe(
      'Вставьте вопросы к экзамену и загрузите лекции. Meldy покажет, где в лекциях ответ на каждый вопрос, чего в них нет и какую долю билетов они закрывают. Потом тяните билет и отвечайте вслух — экзаменатор спросит о том, что вы пропустили.',
    );
    expect(within(hero).getByRole('button', { name: PRIMARY })).toHaveClass('sf-primary');
    expect(within(hero).getByRole('link', { name: /^Как проходит ответ на\sбилет$/ })).toHaveAttribute('href', '#ticket');
    // the hero keeps its paper scene: the lecture page, the card and its caption
    expect(within(hero).getByRole('figure', { name: /Эластичность спроса/ })).toBeInTheDocument();
    expect(within(hero).getByRole('button', { name: 'Перевернуть карточку' })).toHaveAttribute('aria-pressed', 'false');
    expect(plain(hero.querySelector('.ph-invite')?.textContent)).toBe('Что вы пропустили на ответе, Meldy спросит завтра.');
  });

  it('sends «Начать со списка вопросов» to registration, in the hero and in the final call', () => {
    const first = renderLanding();
    fireEvent.click(within(section(first.container, HEADLINE)).getByRole('button', { name: PRIMARY }));
    expect(screen.getByText('Страница регистрации')).toBeInTheDocument();
    cleanup();

    const second = renderLanding();
    const final = section(second.container, 'Начните со списка вопросов');
    fireEvent.click(within(final).getByRole('button', { name: PRIMARY }));
    expect(screen.getByText('Страница регистрации')).toBeInTheDocument();
  });

  it('takes the hero link to «Ответ на билет», smoothly, and at once under reduced motion', () => {
    const scroll = vi.spyOn(HTMLElement.prototype, 'scrollIntoView');
    const first = renderLanding();
    fireEvent.click(screen.getByRole('link', { name: /^Как проходит ответ на\sбилет$/ }));
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(scroll.mock.contexts[0]).toBe(first.container.querySelector('#ticket'));
    expect(scroll).toHaveBeenLastCalledWith({ behavior: 'smooth', block: 'start' });
    cleanup();

    stubMatchMedia(true);
    renderLanding();
    fireEvent.click(screen.getByRole('link', { name: /^Как проходит ответ на\sбилет$/ }));
    expect(scroll).toHaveBeenLastCalledWith({ behavior: 'instant', block: 'start' });
  });

  it('keeps only one pressed-style primary button on the first screen', () => {
    const { container } = renderLanding();
    const navCta = screen.getByRole('button', { name: /Попробовать$/ });
    expect(navCta).toHaveClass('landing-nav-cta', 'sf-nav-cta');
    expect(navCta).not.toHaveClass('sf-primary');
    expect(container.querySelectorAll('nav .sf-primary')).toHaveLength(0);
    expect(section(container, HEADLINE).querySelectorAll('.sf-primary')).toHaveLength(1);
    expect(section(container, 'Ответ на билет').querySelectorAll('.sf-primary, button')).toHaveLength(0);
  });

  it('offers sign-in on every screen width', () => {
    renderLanding();
    expect(screen.getByRole('button', { name: 'Войти' })).not.toHaveClass('hidden');
  });

  it('names the navbar «Ролик · Ответ на билет · Пример · Подход», and every anchor it points to exists', () => {
    const { container } = renderLanding();
    const nav = screen.getByRole('navigation', { name: 'Главное меню' });
    const links = within(nav).getAllByRole('link');
    expect(links.map(a => a.textContent)).toEqual(['Ролик', 'Ответ на билет', 'Пример', 'Подход']);
    const hrefs = links.map(a => a.getAttribute('href'));
    expect(hrefs).toEqual(['#reel', '#ticket', '#try', '#method']);
    for (const href of hrefs) expect(container.querySelector(href!)).not.toBeNull();
    expect(container.querySelector('#possibilities')).toBeNull();
  });

  it('orders the sections: hero, the reel, «Ответ на билет», «Из каждой лекции — ещё и это», «Подход», the final call', () => {
    const { container } = renderLanding();
    expect(sectionNames(container)).toEqual([
      HEADLINE,
      'Meldy за 35 секунд',
      'Ответ на билет',
      'Из каждой лекции — ещё и это',
      'Вспоминать полезнее, чем перечитывать',
      'Начните со списка вопросов',
    ]);
    expect(Array.from(container.querySelectorAll('main > section')).map(s => s.id)).toEqual(['', 'reel', 'ticket', 'try', 'method', '']);
  });

  it('answers a ticket on the landing’s lecture right after the reel', () => {
    const { container } = renderLanding();
    const ticket = section(container, 'Ответ на билет');
    expect(ticket.id).toBe('ticket');
    expect(ticket.querySelectorAll('.lp-tk-pts > li')).toHaveLength(5);
    expect(ticket.querySelectorAll('.lp-tk-pts > li[data-closed]')).toHaveLength(1);
    expect(plain(ticket.textContent)).toContain('вопрос экзаменатора');
    expect(plain(ticket.textContent)).toContain('прежде всего о главном');
    expect(plain(ticket.querySelector('figcaption')?.textContent)).toBe('Пример на лекции «Эластичность спроса»');
  });

  it('puts the summary, the quiz, the conversation and the map under «Из каждой лекции — ещё и это», with no exam chat', () => {
    const { container } = renderLanding();
    const more = section(container, 'Из каждой лекции — ещё и это');
    expect(more.id).toBe('try');
    expect(within(more).queryAllByRole('tab')).toHaveLength(0);
    expect(plain(more.querySelector('.lp-lead')?.textContent)).toBe('Та же лекция: конспект со ссылками на источник и вопрос теста.');
    expect(within(more).getAllByRole('heading', { level: 3 }).map(h => h.textContent)).toEqual(['Конспект', 'Вопрос теста', 'Разговор Макса и Софьи', 'Карта понятий']);
    expect(within(more).queryByRole('button', { name: 'Дальше' })).not.toBeInTheDocument();
    expect(container.querySelector('.lp-exam, .lp-out-exam')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Устный экзамен' })).not.toBeInTheDocument();
  });

  it('lets the visitor drive the card in «Подход» and says when a question counts toward readiness', () => {
    const { container } = renderLanding();
    const method = section(container, 'Вспоминать полезнее, чем перечитывать');
    expect(method.id).toBe('method');
    expect(within(method).getByRole('button', { name: 'Знаю' })).toBeInTheDocument();
    expect(within(method).getByRole('button', { name: 'Не помню' })).toBeInTheDocument();
    expect(method.querySelector('.lp-ink-curve, .lp-ink-strip')).toBeNull();
    const copy = Array.from(method.querySelectorAll('.lp-method-copy p')).map(p => plain(p.textContent));
    expect(copy).toHaveLength(3);
    expect(copy[2]).toBe('Вопрос засчитывается в готовность, когда вы дважды, в разные дни, хорошо на него ответили.');
  });

  it('ends with the department’s list, the formats and a lecture to start from', () => {
    const { container } = renderLanding();
    const final = section(container, 'Начните со списка вопросов');
    expect(plain(final.querySelector('.lp-lead')?.textContent)).toBe(
      'Список вопросов кафедры — текстом или файлом. Лекции — PDF, DOCX, TXT, MD или аудио. Списка пока нет — начните с лекции: карточки и тест Meldy сделает и по ней.',
    );
    expect(final.querySelectorAll('.sf-primary')).toHaveLength(1);
  });

  it('speaks of the session, the tickets and the department, and never promises what the code does not do', () => {
    const { container } = renderLanding();
    const text = plain(container.textContent).toLowerCase();
    expect(text).toMatch(/сессия/);
    expect(text).toMatch(/билет/);
    expect(text).toMatch(/кафедр/);
    for (const banned of [
      'только у нас', 'шанс сдать', 'подтверждено ответами вслух', 'звук не покидает', 'дословно взяты из лекций', 'вы выучили', 'спросит отдельно',
    ]) {
      expect(text).not.toContain(banned);
    }
  });

  it('says each sentence once, the formats once, and the reread-versus-recall contrast only in «Подход»', () => {
    const { container } = renderLanding();
    const blocks = visibleBlocks(container);
    const all = sentences(blocks);
    const seen = new Map<string, number>();
    for (const s of all) seen.set(s, (seen.get(s) ?? 0) + 1);
    expect([...seen].filter(([, n]) => n > 1)).toEqual([]);
    const text = plain(container.textContent);
    expect(text.match(FORMATS)).toHaveLength(1);
    const contrast = blocks.filter(b => /перечит/i.test(b));
    expect(contrast).toEqual(['Вспоминать полезнее, чем перечитывать']);
  });

  it('drops eyebrows, meta labels, fake precision, demo instructions and the old sections', () => {
    const { container } = renderLanding();
    const text = plain(container.textContent);
    for (const banned of [
      'ВАШ МАТЕРИАЛ', 'Интерактивный пример', 'Этапы анимации', 'абз.', 'стр.', 'Разобраться.', 'через три недели', 'Без регистрации', 'из 5', '1 из 5',
      'Память крепнет', 'Эффект тестирования', 'Показать ещё раз', 'Нажмите на тезис', 'Ответьте про себя', 'Линия — сколько', 'Попробуйте вспомнить',
      'Ваша очередь', 'Что ещё получится', 'Возможности', 'Пройти пример без регистрации', 'Попробовать на своей лекции', 'Запомнить лекцию',
    ]) {
      expect(text).not.toContain(banned);
    }
    expect(container.querySelector('.sf-eyebrow, .landing-eyebrow, .sf-try-eyebrow')).toBeNull();
    expect(container.querySelector('svg.lucide')).toBeNull();
    const footer = container.querySelector('footer')!;
    expect(footer.textContent?.match(/Meldy/g)).toHaveLength(1);
  });
});
