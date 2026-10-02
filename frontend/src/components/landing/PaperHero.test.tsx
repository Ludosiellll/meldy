import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import PaperHero, { FACE_TEXT, INVITE_TEXT, SEEN_KEY, STEPS_TEXT } from './PaperHero';

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

/** IntersectionObserver whose reports the test controls. */
const observers: ControlledObserver[] = [];
class ControlledObserver {
  readonly targets: Element[] = [];
  constructor(private readonly callback: IntersectionObserverCallback) { observers.push(this); }
  observe(target: Element) {
    this.targets.push(target);
    this.report(target, ControlledObserver.initialRatio);
  }
  report(target: Element, ratio: number) {
    this.callback([{ isIntersecting: ratio > 0, intersectionRatio: ratio, target } as unknown as IntersectionObserverEntry], this as unknown as IntersectionObserver);
  }
  unobserve() {}
  disconnect() {}
  takeRecords() { return []; }
  static initialRatio = 1;
}

const scene = () => document.querySelector<HTMLElement>('.ph-scene')!;
const phase = () => scene().dataset.phase;
const face = () => document.querySelector<HTMLElement>('.ph-flipper')!.dataset.face;
const card = () => screen.getByRole('button', { name: 'Перевернуть карточку' });
const sentence = () => document.querySelector<HTMLElement>('.ph-key-hit')!;

describe('PaperHero', () => {
  beforeEach(() => {
    observers.length = 0;
    ControlledObserver.initialRatio = 1;
    vi.stubGlobal('IntersectionObserver', ControlledObserver);
    window.sessionStorage.clear();
    mockMatchMedia(false);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    window.sessionStorage.clear();
  });

  it('describes the scene for screen readers and keeps decoration hidden', () => {
    ControlledObserver.initialRatio = 0;
    render(<PaperHero />);
    expect(screen.getByRole('figure', { name: /Эластичность спроса/ })).toBeInTheDocument();
    expect(card()).toHaveAttribute('aria-pressed', 'false');
    expect(card()).toHaveAccessibleDescription(FACE_TEXT.question);
    expect(document.querySelector('.ph-page')).toHaveAttribute('aria-hidden', 'true');
    expect(phase()).toBe('waiting');
  });

  it('has no demo controls: one caption under the card, no replay button', () => {
    window.sessionStorage.setItem(SEEN_KEY, '1');
    render(<PaperHero />);
    expect(phase()).toBe('done');
    expect(screen.getByText(INVITE_TEXT)).toHaveClass('ph-invite');
    expect(screen.queryByRole('button', { name: /ещё раз/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: STEPS_TEXT })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });

  it('renders the final frame and offers the stills only when motion is reduced', () => {
    mockMatchMedia(true);
    render(<PaperHero />);
    expect(phase()).toBe('done');
    expect(face()).toBe('question');
    expect(screen.getByRole('button', { name: STEPS_TEXT })).toBeVisible();
    expect(window.sessionStorage.getItem(SEEN_KEY)).toBeNull();
  });

  it('waits for the key sentence and the card to be in view', () => {
    ControlledObserver.initialRatio = 0.5;
    render(<PaperHero />);
    expect(phase()).toBe('waiting');
    act(() => {
      for (const o of observers) for (const t of o.targets) o.report(t, 1);
    });
    expect(phase()).toBe('playing');
  });

  it('waits for the fonts before playing', async () => {
    let release: () => void = () => {};
    const pending = new Promise<void>(resolve => { release = resolve; });
    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: { check: () => false, load: () => pending, ready: pending },
    });
    try {
      render(<PaperHero />);
      expect(phase()).toBe('waiting');
      expect(document.querySelector('.ph-fit')).toHaveAttribute('data-fonts', 'pending');
      await act(async () => { release(); await pending; });
      await waitFor(() => expect(phase()).toBe('playing'));
    } finally {
      delete (document as unknown as { fonts?: unknown }).fonts;
    }
  });

  it('turns the card with aria-pressed and a live announcement, always the same way round', () => {
    window.sessionStorage.setItem(SEEN_KEY, '1');
    render(<PaperHero />);
    const live = document.querySelector('.ph-fit [aria-live="polite"]')!;
    fireEvent.click(card());
    expect(card()).toHaveAttribute('aria-pressed', 'true');
    expect(live).toHaveTextContent(FACE_TEXT.answer);
    expect(card()).toHaveAccessibleDescription(FACE_TEXT.answer);
    fireEvent.click(card());
    expect(card()).toHaveAttribute('aria-pressed', 'false');
    expect(live).toHaveTextContent(FACE_TEXT.question);
  });

  it('settles to the end when Esc is pressed during play, and Esc again finishes the fast-forward', async () => {
    render(<PaperHero />);
    expect(phase()).toBe('playing');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(phase()).toBe('settling');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(phase()).toBe('done');
    await waitFor(() => expect(face()).toBe('question'));
    expect(window.sessionStorage.getItem(SEEN_KEY)).toBe('1');
  });

  it('plays the rest at speed after a skip and ends on the question', async () => {
    render(<PaperHero />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(phase()).toBe('settling');
    await waitFor(() => expect(phase()).toBe('done'), { timeout: 2000 });
    expect(face()).toBe('question');
  });

  it('ignores Esc while the visitor types somewhere else', () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    try {
      render(<PaperHero />);
      input.focus();
      fireEvent.keyDown(input, { key: 'Escape' });
      expect(phase()).toBe('playing');
    } finally {
      input.remove();
    }
  });

  it('skips on a first click on the card and turns it on a second one during the fast-forward', () => {
    render(<PaperHero />);
    expect(phase()).toBe('playing');
    fireEvent.click(card());
    expect(phase()).toBe('settling');
    expect(card()).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(card());
    expect(phase()).toBe('done');
    expect(card()).toHaveAttribute('aria-pressed', 'true');
  });

  it('settles at once when the scene leaves the viewport mid-play', () => {
    render(<PaperHero />);
    expect(phase()).toBe('playing');
    act(() => {
      for (const o of observers) o.report(scene(), 0.1);
    });
    expect(phase()).toBe('done');
    expect(window.sessionStorage.getItem(SEEN_KEY)).toBe('1');
  });

  it('plays the take again from a click on the underlined sentence', async () => {
    window.sessionStorage.setItem(SEEN_KEY, '1');
    render(<PaperHero />);
    fireEvent.click(card());
    expect(card()).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(sentence());
    expect(phase()).toBe('replaying');
    expect(document.querySelector<HTMLElement>('.ph-fit')!.style.opacity).toBe('0');
    expect(card()).toHaveAttribute('aria-pressed', 'false');
    // clicks on the card are ignored while the visual is faded out
    fireEvent.click(card());
    expect(card()).toHaveAttribute('aria-pressed', 'false');
    await waitFor(() => expect(phase()).toBe('playing'), { timeout: 2000 });
    expect(document.querySelector<HTMLElement>('.ph-fit')!.style.opacity).toBe('');
    expect(face()).toBe('answer');
  });

  it('marks the sentence under the pointer so its pencil inks fully', () => {
    window.sessionStorage.setItem(SEEN_KEY, '1');
    render(<PaperHero />);
    const page = document.querySelector<HTMLElement>('.ph-page')!;
    fireEvent.pointerEnter(sentence());
    expect(page.dataset.hot).toBe('true');
    fireEvent.pointerLeave(sentence());
    expect(page.dataset.hot).toBeUndefined();
  });

  it('carries the slip inside the card: it is on the card face once the take is over', () => {
    window.sessionStorage.setItem(SEEN_KEY, '1');
    render(<PaperHero />);
    const slip = document.querySelector<HTMLElement>('.ph-strip-pos')!;
    expect(slip.closest('.ph-face-answer')).not.toBeNull();
    expect(slip.style.visibility).toBe('inherit');
    expect(slip.textContent?.replace(/ /g, ' ')).toContain('Спрос эластичен');
    expect(document.querySelector('.ph-pasted')).toBeNull();
  });

  it('cuts a skip during the underline straight to the touch', async () => {
    render(<PaperHero />);
    expect(phase()).toBe('playing');
    const slip = document.querySelector<HTMLElement>('.ph-strip-pos')!;
    expect(slip.style.visibility).toBe('hidden');
    fireEvent.click(scene());
    expect(phase()).toBe('settling');
    await waitFor(() => expect(slip.style.visibility).toBe('inherit'), { timeout: 200, interval: 10 });
  });

  it('marks the scene live for will-change only while the visitor is at the card', async () => {
    window.sessionStorage.setItem(SEEN_KEY, '1');
    render(<PaperHero />);
    expect(scene().dataset.live).toBeUndefined();
    fireEvent.focus(card());
    expect(scene().dataset.live).toBe('true');
    await waitFor(() => expect(scene().dataset.live).toBeUndefined(), { timeout: 2000 });
  });

  it('has no meta labels, counters, graph paper or old animation controls', () => {
    const { container } = render(<PaperHero />);
    const text = container.textContent ?? '';
    for (const banned of ['ВАШ МАТЕРИАЛ', 'Этапы анимации', 'стр.', 'абз.', 'из 5', 'тезиса', 'понятия', 'Показать ещё раз', 'Эффект тестирования']) {
      expect(text).not.toContain(banned);
    }
    expect(screen.queryByRole('group', { name: 'Этапы анимации' })).not.toBeInTheDocument();
  });
});
