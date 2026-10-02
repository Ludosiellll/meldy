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
  });

  it('keeps the hero promise and shows the study-kit visual', () => {
    render(<MemoryRouter><Landing /></MemoryRouter>);

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Разобраться.Запомнить.Ответить.');
    expect(screen.getByRole('button', { name: /Начать с моей лекции/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Попробовать на примере/ })).toHaveAttribute('href', '#try');
    expect(screen.getByText('PDF, DOCX, TXT, MD · аудиозаписи')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Этапы анимации' })).toBeInTheDocument();
    expect(screen.queryByText(/От первого прочтения/)).not.toBeInTheDocument();
  });

  it('keeps only one pressed-style primary button on the first screen', () => {
    const { container } = render(<MemoryRouter><Landing /></MemoryRouter>);

    const navCta = screen.getByRole('button', { name: /Попробовать$/ });
    expect(navCta).toHaveClass('landing-nav-cta', 'sf-nav-cta');
    expect(navCta).not.toHaveClass('landing-button-primary');
    expect(container.querySelectorAll('nav .landing-button-primary')).toHaveLength(0);
  });

  it('moves the interactive demo into «Попробуйте сами» as three tabs without autoplay', () => {
    render(<MemoryRouter><Landing /></MemoryRouter>);

    const section = screen.getByRole('region', { name: 'Попробуйте сами' });
    expect(within(section).getAllByRole('tab')).toHaveLength(3);
    expect(within(section).queryByRole('button', { name: /демо/ })).not.toBeInTheDocument();
    expect(within(section).queryByText(/В ДЕЙСТВИИ/)).not.toBeInTheDocument();
    expect(within(section).getByRole('tabpanel')).toBeInTheDocument();
  });

  it('describes the closed study loop without dead links or a planner claim', () => {
    render(<MemoryRouter><Landing /></MemoryRouter>);

    expect(screen.getByRole('heading', { name: 'Один материал — весь цикл подготовки' })).toBeInTheDocument();
    for (const title of [
      'Конспект со ссылками на источник',
      'Карточки с интервальным повторением',
      'Тест с разбором ответов',
      'Разговор двух ведущих со схемами',
      'Карта знаний',
      'Устный экзамен',
    ]) {
      expect(screen.getByRole('heading', { name: title })).toBeInTheDocument();
    }
    expect(screen.queryByText(/Шесть учебных инструментов/)).not.toBeInTheDocument();
    expect(screen.queryByText('План подготовки')).not.toBeInTheDocument();
    expect(screen.queryByText(/Возможность приложения/)).not.toBeInTheDocument();
  });
});
