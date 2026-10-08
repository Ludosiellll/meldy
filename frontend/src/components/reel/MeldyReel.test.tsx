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
  it('is a captioned figure of 48 seconds whose moving stage is hidden from screen readers, with a transcript instead', () => {
    const { container } = render(<MeldyReel />);
    expect(screen.getByRole('figure', { name: 'Ролик о Meldy, 48 секунд, без звука.' })).toBeInTheDocument();
    expect(container.querySelector('.mr-stage')).toHaveAttribute('aria-hidden', 'true');
    const transcript = Array.from(container.querySelectorAll('ol.mr-sr li'), (item) => item.textContent ?? '');
    expect(transcript).toHaveLength(7);
    expect(transcript[0]).toBe('Список кафедры: распознано 12 вопросов.');
    expect(transcript.join(' ')).toContain('Билет вслух: «Выручка продавца');
    expect(transcript.join(' ')).toContain('По ключевым словам: 2 из 4.');
    expect(transcript.join(' ')).toContain('«была стёрта · пункт не назван»');
    expect(transcript[6]).toContain('Попробовать на примере');
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

  it('has the seven chapters of the film on its bar, and jumps to a chapter’s own moment', () => {
    render(<MeldyReel />);
    expect(SEGMENTS.map((segment) => segment.label)).toEqual(CHAPTERS.map((chapter) => chapter.label));
    expect(SEGMENTS[0].from).toBe(0);
    expect(SEGMENTS[SEGMENTS.length - 1].to).toBe(TOTAL);
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Перейти: Шпаргалка' }));
    });
    expect(screen.getByRole('button', { name: 'Перейти: Шпаргалка' })).toHaveAttribute('aria-current', 'step');
    expect(screen.getByRole('button', { name: 'Перейти: Список кафедры' })).not.toHaveAttribute('aria-current');
    expect(screen.getByText('Шпаргалка', { selector: '.mr-now' })).toBeInTheDocument();
  });

  it('with reduced motion waits on a still frame until asked to play', () => {
    reduced = true;
    render(<MeldyReel />);
    showReel(true);
    expect(screen.getByRole('button', { name: 'Смотреть' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Смотреть ролик' }));
    expect(screen.queryByRole('button', { name: 'Смотреть ролик' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Пауза' })).toBeInTheDocument();
  });

  it('offers the frame exporter a clock it can step, and does not play by itself then', () => {
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
