import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import StudyKitHero from './StudyKitHero';

const STEP_LABELS = ['Материал', 'Конспект', 'Карточки', 'Тест', 'Карта и разговор'];

function mockMatchMedia(reduce: boolean) {
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

/** IntersectionObserver that reports every observed element as fully visible. */
class VisibleObserver {
  private readonly callback: IntersectionObserverCallback;
  constructor(callback: IntersectionObserverCallback) { this.callback = callback; }
  observe(target: Element) {
    this.callback([{ isIntersecting: true, intersectionRatio: 1, target } as unknown as IntersectionObserverEntry], this as unknown as IntersectionObserver);
  }
  unobserve() {}
  disconnect() {}
  takeRecords() { return []; }
}

function figure() {
  return screen.getByRole('figure');
}

describe('StudyKitHero', () => {
  beforeEach(() => {
    vi.stubGlobal('IntersectionObserver', VisibleObserver);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('renders the lecture page, the five step controls and playback buttons', () => {
    mockMatchMedia(false);
    render(<StudyKitHero />);

    expect(screen.getByText('Как работает память')).toBeInTheDocument();
    const steps = screen.getByRole('group', { name: 'Этапы анимации' });
    for (const label of STEP_LABELS) {
      expect(screen.getByRole('button', { name: label })).toBeEnabled();
    }
    expect(steps.querySelectorAll('button')).toHaveLength(5);
    // The paper is fully there before anything plays; counters wait for their content.
    expect(screen.getByText('Как работает память').closest('[data-sfk-paper]')).not.toHaveStyle({ opacity: '0' });
    expect(screen.getByText('3 тезиса').closest('.sfk-card-meta')).toHaveStyle({ opacity: '0' });
    expect(screen.getByRole('button', { name: 'Приостановить анимацию' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Показать анимацию сначала' })).toBeInTheDocument();
    expect(figure()).toHaveAttribute('data-autoplay', 'true');
    expect(figure()).toHaveAttribute('data-composed', 'false');
  });

  it('jumps to a composed stage and pauses when a step is selected', () => {
    mockMatchMedia(false);
    render(<StudyKitHero />);

    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Карта и разговор' })); });

    expect(figure()).toHaveAttribute('data-stage', '4');
    expect(figure()).toHaveAttribute('data-composed', 'true');
    expect(figure()).toHaveAttribute('data-autoplay', 'false');
    expect(screen.getByRole('button', { name: 'Карта и разговор' })).toHaveAttribute('aria-current', 'step');
    // On the composed state the play button starts the scene again.
    expect(screen.getByRole('button', { name: 'Запустить анимацию' })).toBeInTheDocument();

    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Тест' })); });
    expect(figure()).toHaveAttribute('data-stage', '3');
    expect(figure()).toHaveAttribute('data-composed', 'false');
    expect(screen.getByRole('button', { name: 'Продолжить анимацию' })).toBeInTheDocument();

    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Показать анимацию сначала' })); });
    expect(figure()).toHaveAttribute('data-stage', '0');
    expect(figure()).toHaveAttribute('data-autoplay', 'true');
  });

  it('shows the composed state without autoplay when reduced motion is preferred', () => {
    vi.useFakeTimers();
    mockMatchMedia(true);
    render(<StudyKitHero />);

    const root = figure();
    expect(root).toHaveAttribute('data-composed', 'true');
    expect(root).toHaveAttribute('data-stage', '4');
    expect(root).toHaveAttribute('data-autoplay', 'false');

    // Every artifact of the kit is fully visible in the static state.
    const subtitle = root.querySelector('[data-sfk-subtitle]') as HTMLElement;
    expect(subtitle).toHaveTextContent('Софья: Повторы выравнивают кривую забывания.');
    subtitle.querySelectorAll('span').forEach(word => expect(word).toHaveStyle({ opacity: '1' }));
    const explain = root.querySelector('.sfk-explain') as HTMLElement;
    expect(explain).toHaveTextContent('Перечитывание не проверяет память.');
    expect(explain).toHaveStyle({ opacity: '1' });
    // The flashcard answer keeps its question visible.
    expect(screen.getAllByText('Что такое активное вспоминание?')).toHaveLength(2);
    expect(screen.getByText('Вспомнить самому, не глядя в текст')).toBeInTheDocument();
    expect(screen.getByText('3 тезиса').closest('.sfk-card-meta')).toHaveStyle({ opacity: '1' });

    // No playback controls; the steps still work as an instant jump.
    expect(screen.queryByRole('button', { name: /анимацию/ })).not.toBeInTheDocument();
    for (const label of STEP_LABELS) {
      expect(screen.getByRole('button', { name: label })).toBeEnabled();
    }
    expect(screen.getByRole('button', { name: 'Карта и разговор' })).toHaveAttribute('aria-current', 'step');

    act(() => { vi.advanceTimersByTime(5000); });
    expect(root).toHaveAttribute('data-composed', 'true');
    expect(root).toHaveAttribute('data-stage', '4');

    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Карточки' })); });
    expect(root).toHaveAttribute('data-stage', '2');
    act(() => { vi.advanceTimersByTime(5000); });
    expect(root).toHaveAttribute('data-stage', '2');
    expect(root).toHaveAttribute('data-autoplay', 'false');
  });
});
