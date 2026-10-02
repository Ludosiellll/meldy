import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
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

function renderLanding() {
  return render(<MemoryRouter><Landing /></MemoryRouter>);
}

const FORMATS = /PDF, DOCX, TXT, MD или\sаудиозапись/g;
const plain = (s: string) => s.replace(/ /g, ' ').replace(/\s+/g, ' ').trim();

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
    vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    window.sessionStorage.clear();
  });

  it('states the promise and describes what the scene shows', () => {
    renderLanding();
    const heading = screen.getByRole('heading', { level: 1 });
    expect(plain(heading.textContent ?? '')).toBe('Запомнить лекцию, а не перечитывать её в пятый раз');
    const hero = screen.getByRole('region', { name: /Запомнить лекцию/ });
    expect(within(hero).getByText(/^Загрузите лекцию\s— Meldy подчеркнёт главное, сделает из\sнего карточки и\sспросит вас о\sнём завтра\.$/)).toBeInTheDocument();
    expect(within(hero).getByRole('button', { name: 'Попробовать на своей лекции' })).toBeInTheDocument();
    expect(within(hero).getByRole('link', { name: 'Пройти пример без регистрации' })).toHaveAttribute('href', '#try');
    expect(within(hero).getByRole('figure', { name: /Эластичность спроса/ })).toBeInTheDocument();
    expect(within(hero).getByRole('button', { name: 'Перевернуть карточку' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('keeps only one pressed-style primary button on the first screen', () => {
    const { container } = renderLanding();
    const navCta = screen.getByRole('button', { name: /Попробовать$/ });
    expect(navCta).toHaveClass('landing-nav-cta', 'sf-nav-cta');
    expect(navCta).not.toHaveClass('sf-primary');
    expect(container.querySelectorAll('nav .sf-primary')).toHaveLength(0);
    const hero = screen.getByRole('region', { name: /Запомнить лекцию/ });
    expect(hero.querySelectorAll('.sf-primary')).toHaveLength(1);
  });

  it('offers sign-in on every screen width', () => {
    renderLanding();
    expect(screen.getByRole('button', { name: 'Войти' })).not.toHaveClass('hidden');
  });

  it('shows the same lecture in «Ваша очередь»: summary with sources and a quiz question, no tabs', () => {
    renderLanding();
    const section = screen.getByRole('region', { name: 'Ваша очередь' });
    expect(within(section).queryAllByRole('tab')).toHaveLength(0);
    expect(within(section).getByText(/^Та же лекция: конспект со\sссылками на\sисточник и\sвопрос теста\.$/)).toBeInTheDocument();
    expect(within(section).getByRole('heading', { level: 3, name: 'Конспект' })).toBeInTheDocument();
    expect(within(section).getByRole('heading', { level: 3, name: 'Вопрос теста' })).toBeInTheDocument();
  });

  it('shows the conversation as the main output, then the map and the oral exam', () => {
    renderLanding();
    const section = screen.getByRole('region', { name: /^Что ещё получится из\sэтой лекции$/ });
    expect(within(section).getAllByRole('heading', { level: 3 }).map(h => h.textContent)).toEqual(['Разговор Макса и Софьи', 'Карта понятий', 'Устный экзамен']);
    expect(within(section).queryByRole('button', { name: 'Дальше' })).not.toBeInTheDocument();
  });

  it('lets the visitor drive the card in «Подход»', () => {
    renderLanding();
    const section = screen.getByRole('region', { name: 'Вспоминать полезнее, чем перечитывать' });
    expect(within(section).getByRole('button', { name: 'Знаю' })).toBeInTheDocument();
    expect(within(section).getByRole('button', { name: 'Не помню' })).toBeInTheDocument();
    expect(section.querySelector('.lp-ink-curve, .lp-ink-strip')).toBeNull();
  });

  it('keeps every anchor the navbar points to', () => {
    const { container } = renderLanding();
    const nav = screen.getByRole('navigation', { name: 'Главное меню' });
    const hrefs = within(nav).getAllByRole('link').map(a => a.getAttribute('href'));
    expect(hrefs).toEqual(['#try', '#possibilities', '#method']);
    for (const href of hrefs) expect(container.querySelector(href!)).not.toBeNull();
  });

  it('says each sentence once, and the reread-versus-recall contrast only in the hero and in «Подход»', () => {
    const { container } = renderLanding();
    const blocks = visibleBlocks(container);
    const all = sentences(blocks);
    const seen = new Map<string, number>();
    for (const s of all) seen.set(s, (seen.get(s) ?? 0) + 1);
    expect([...seen].filter(([, n]) => n > 1)).toEqual([]);
    const text = plain(container.textContent ?? '');
    expect(text.match(FORMATS)).toHaveLength(1);
    const contrast = blocks.filter(b => /перечит/i.test(b));
    expect(contrast).toEqual(['Запомнить лекцию, а не перечитывать её в пятый раз', 'Вспоминать полезнее, чем перечитывать']);
  });

  it('drops eyebrows, meta labels, fake precision and demo instructions', () => {
    const { container } = renderLanding();
    const text = container.textContent ?? '';
    for (const banned of [
      'ВАШ МАТЕРИАЛ', 'Интерактивный пример', 'Этапы анимации', 'абз.', 'стр.', 'Разобраться.', 'через три недели', 'Без регистрации', 'из 5', '1 из',
      'Память крепнет', 'Эффект тестирования', 'Показать ещё раз', 'Нажмите на тезис', 'Ответьте про себя', 'Линия — сколько', 'Попробуйте вспомнить',
    ]) {
      expect(text).not.toContain(banned);
    }
    expect(container.querySelector('.sf-eyebrow, .landing-eyebrow, .sf-try-eyebrow')).toBeNull();
    expect(container.querySelector('svg.lucide')).toBeNull();
    const footer = container.querySelector('footer')!;
    expect(footer.textContent?.match(/Meldy/g)).toHaveLength(1);
  });
});
