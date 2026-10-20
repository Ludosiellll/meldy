import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Reel3, { TRANSCRIPT3 } from './Reel3';
import { SAY } from '../home3/copy3';
import { CHAPTERS3, scene3 } from './timeline3';

type Callback = (entries: Array<{ isIntersecting: boolean; intersectionRatio: number }>) => void;
let observed: Callback[] = [];
let narrow = false;
let reduced = false;

class FakeIntersectionObserver {
  constructor(callback: Callback) {
    observed.push(callback);
  }
  observe() {}
  disconnect() {}
  unobserve() {}
  takeRecords() {
    return [];
  }
}

class FakeResizeObserver {
  observe() {}
  disconnect() {}
  unobserve() {}
}

beforeEach(() => {
  observed = [];
  narrow = false;
  reduced = false;
  vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('reduce') ? reduced : query.includes('max-width') ? narrow : false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 800 });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  delete window.__MELDY_REEL_EXPORT__;
  delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth;
});

describe('Reel3', () => {
  it('is a captioned figure: the stage is hidden from screen readers, the transcript says every sentence', () => {
    const { container } = render(<Reel3 />);
    expect(screen.getByRole('figure', { name: 'Ролик о Meldy, 76 секунд, без звука.' })).toBeInTheDocument();
    expect(container.querySelector('.r3-stage')).toHaveAttribute('aria-hidden', 'true');
    expect(TRANSCRIPT3).toEqual(Object.values(SAY).flatMap((lines) => lines.map((line) => `${line}.`)));
    expect(container.querySelectorAll('ol.r3-sr li')).toHaveLength(TRANSCRIPT3.length);
  });

  it('uses the tall stage on a phone-wide window and the wide one otherwise', () => {
    const { container, unmount } = render(<Reel3 />);
    expect(container.querySelector('.r3-frame')).toHaveAttribute('data-layout', 'wide');
    unmount();
    narrow = true;
    const again = render(<Reel3 />);
    expect(again.container.querySelector('.r3-frame')).toHaveAttribute('data-layout', 'tall');
  });

  it('draws every scene at its time (the frame exporter steps the clock)', async () => {
    window.__MELDY_REEL_EXPORT__ = true;
    const { container } = render(<Reel3 />);
    for (const id of ['lecture', 'file', 'plan', 'session', 'ticket', 'sheet', 'group', 'build', 'media', 'look', 'send', 'take', 'stats'] as const) {
      const window3 = scene3(id);
      await act(async () => {
        await window.__meldyReel!.seek(Math.round((window3.from + window3.to) / 2));
      });
      const words = (container.querySelector('.r3-stage')?.textContent ?? '').replace(/\s+/g, ' ');
      expect(words, id).toContain(SAY[id][0].split(' ')[0]);
    }
  });

  it('lists the eight chapters under the frame and jumps to one', () => {
    const { container } = render(<Reel3 />);
    const buttons = screen.getAllByRole('button', { name: /^Перейти:/ });
    expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual(CHAPTERS3.map((chapter) => `Перейти: ${chapter.label}`));
    fireEvent.click(buttons[7]);
    expect(container.querySelector('[aria-current="step"]')).toHaveAttribute('aria-label', 'Перейти: Конструктор');
  });

  it('waits on its poster under reduced motion until asked', () => {
    reduced = true;
    render(<Reel3 />);
    act(() => {
      for (const callback of observed) callback([{ isIntersecting: true, intersectionRatio: 1 }]);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Смотреть ролик' }));
    expect(screen.queryByRole('button', { name: 'Смотреть ролик' })).toBeNull();
  });
});
