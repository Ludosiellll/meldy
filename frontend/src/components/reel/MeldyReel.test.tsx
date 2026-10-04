import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MeldyReel, { SEGMENTS } from './MeldyReel';
import { CHAPTERS, TOTAL } from './timeline';

type Callback = (entries: Array<{ isIntersecting: boolean; intersectionRatio: number }>) => void;

let observed: Callback[] = [];
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

function showReel(visible = true) {
  act(() => {
    for (const callback of observed) callback([{ isIntersecting: visible, intersectionRatio: visible ? 1 : 0 }]);
  });
}

const hudLabel = (container: HTMLElement) => container.querySelector('.mr-hud-t--tr')?.textContent ?? '';

beforeEach(() => {
  observed = [];
  reduced = false;
  vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('reduce') ? reduced : false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    onchange: null,
    dispatchEvent: () => false,
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('MeldyReel', () => {
  it('is a captioned figure whose moving stage is hidden from screen readers, with a transcript instead', () => {
    const { container } = render(<MeldyReel />);
    expect(screen.getByRole('figure', { name: 'Ролик о Meldy, 35 секунд, без звука.' })).toBeInTheDocument();
    expect(container.querySelector('.mr-stage')).toHaveAttribute('aria-hidden', 'true');
    const transcript = container.querySelectorAll('ol.mr-sr li');
    expect(transcript.length).toBeGreaterThanOrEqual(6);
    expect(transcript[2].textContent).toContain('24 из 40');
  });

  it('plays only while it is on screen', () => {
    render(<MeldyReel />);
    expect(screen.getByRole('button', { name: 'Смотреть' })).toBeInTheDocument();
    showReel(true);
    expect(screen.getByRole('button', { name: 'Пауза' })).toBeInTheDocument();
    showReel(false);
    expect(screen.getByRole('button', { name: 'Смотреть' })).toBeInTheDocument();
  });

  it('pauses and resumes from its button', () => {
    render(<MeldyReel />);
    showReel(true);
    fireEvent.click(screen.getByRole('button', { name: 'Пауза' }));
    expect(screen.getByRole('button', { name: 'Смотреть' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Смотреть' }));
    expect(screen.getByRole('button', { name: 'Пауза' })).toBeInTheDocument();
  });

  it('jumps to a chapter from the bar and marks it as the current one', () => {
    const { container } = render(<MeldyReel />);
    expect(SEGMENTS.map((segment) => segment.label)).toEqual(['Начало', 'Билеты', 'Ответ вслух', 'Повторение', 'Готовность', 'Итог']);
    expect(SEGMENTS[0].from).toBe(0);
    expect(SEGMENTS[SEGMENTS.length - 1].to).toBe(TOTAL);
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Перейти: Ответ вслух' }));
    });
    expect(screen.getByRole('button', { name: 'Перейти: Ответ вслух' })).toHaveAttribute('aria-current', 'step');
    expect(screen.getByRole('button', { name: 'Перейти: Билеты' })).not.toHaveAttribute('aria-current');
  });

  it('types the chapter into the corner label while it plays', () => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance'] });
    try {
      const { container } = render(<MeldyReel />);
      act(() => {
        fireEvent.click(screen.getByRole('button', { name: 'Перейти: Повторение' }));
      });
      expect('03 / ПОВТОРЕНИЕ'.startsWith(hudLabel(container))).toBe(true);
      showReel(true);
      act(() => {
        vi.advanceTimersByTime(1200);
      });
      expect(hudLabel(container)).toBe('03 / ПОВТОРЕНИЕ');
    } finally {
      vi.useRealTimers();
    }
  });

  it('with reduced motion waits on a still frame of the ticket chapter until asked to play', () => {
    reduced = true;
    const { container } = render(<MeldyReel />);
    showReel(true);
    expect(screen.getByRole('button', { name: 'Смотреть' })).toBeInTheDocument();
    expect(hudLabel(container)).toBe(`${CHAPTERS[0].number} / ${CHAPTERS[0].label}`.toUpperCase());
    fireEvent.click(screen.getByRole('button', { name: 'Смотреть ролик' }));
    expect(screen.queryByRole('button', { name: 'Смотреть ролик' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Пауза' })).toBeInTheDocument();
  });

  it('offers the frame exporter a clock it can step, and does not play by itself then', async () => {
    window.__MELDY_REEL_EXPORT__ = true;
    try {
      render(<MeldyReel />);
      showReel(true);
      expect(window.__meldyReel?.total).toBe(TOTAL);
      expect(screen.queryByRole('button', { name: 'Пауза' })).not.toBeInTheDocument();
    } finally {
      delete window.__MELDY_REEL_EXPORT__;
    }
  });
});
