import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Landing from '../../pages/Landing';
import { withArrows } from './SheetArrow';

vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({ user: null }),
}));

/** Every observer the page makes, with what it watches, so a test can say what is on screen. */
const observers: Array<{ callback: IntersectionObserverCallback; targets: Element[] }> = [];
class RecordingObserver {
  private readonly entry: { callback: IntersectionObserverCallback; targets: Element[] };
  constructor(callback: IntersectionObserverCallback) {
    this.entry = { callback, targets: [] };
    observers.push(this.entry);
  }
  observe(target: Element) {
    this.entry.targets.push(target);
  }
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}

beforeEach(() => {
  observers.length = 0;
  vi.stubGlobal('IntersectionObserver', RecordingObserver);
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({ matches: false, media: query, onchange: null, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn() })),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const renderLanding = () =>
  render(
    <MemoryRouter initialEntries={['/']}>
      <Landing />
    </MemoryRouter>,
  );

describe('the landing stays light on a phone', () => {
  it('draws the arrows of the cheat-sheet lines: no character of Onest’s symbols file is left in the page', () => {
    const { container } = renderLanding();
    // Arrows, arrows and shapes of Onest's symbols subset (the 19 KB file the arrows used to fetch).
    expect(container.textContent).not.toMatch(/[←→↔-↙⇦-⇰⌀-⓿■-➿⬀-⯿]/);
    expect(container.querySelectorAll('.hm-mini-l svg.hm-arrow-g').length).toBe(2);
    expect(container.querySelectorAll('.hs-words svg.hm-arrow-g').length).toBeGreaterThanOrEqual(3);
  });

  it('the mic pulses only while it is on screen', () => {
    const { container } = renderLanding();
    const mic = container.querySelector('.hm-mic')!;
    const watching = observers.find((observer) => observer.targets.includes(mic))!;
    expect(mic.hasAttribute('data-live')).toBe(false);
    const say = (isIntersecting: boolean) =>
      act(() => watching.callback([{ isIntersecting, target: mic } as unknown as IntersectionObserverEntry], {} as IntersectionObserver));
    say(true);
    expect(mic.hasAttribute('data-live')).toBe(true);
    say(false);
    expect(mic.hasAttribute('data-live')).toBe(false);
  });
});

describe('withArrows', () => {
  it('keeps the words around each arrow and draws the arrow', () => {
    const { container } = render(<p>{withArrows('доля в бюджете ↑ → эластичность ↑')}</p>);
    expect(container.textContent).toBe('доля в бюджете ↑  эластичность ↑');
    expect(container.querySelectorAll('svg')).toHaveLength(1);
    expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('leaves a line without an arrow as plain text', () => {
    expect(withArrows('выручка = цена × количество')).toBe('выручка = цена × количество');
  });
});
