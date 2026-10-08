import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QUOTE } from './content';
import MeldyReel, { REEL_SECONDS, SEGMENTS } from './MeldyReel';
import { OUTRO_CTA_LABEL } from './scenes/Outro';
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
  it('is a captioned figure whose moving stage is hidden from screen readers, with a transcript instead', () => {
    const { container } = render(<MeldyReel />);
    expect(screen.getByRole('figure', { name: 'Ролик о Meldy, 36 секунд, без звука.' })).toBeInTheDocument();
    expect(REEL_SECONDS).toBe(Math.round(TOTAL / 1000));
    expect(container.querySelector('.mr-stage')).toHaveAttribute('aria-hidden', 'true');
    const transcript = container.querySelectorAll('ol.mr-sr li');
    expect(transcript.length).toBeGreaterThanOrEqual(6);
    expect(transcript[2].textContent).toContain('24 из 40');
    // The chapters of the sheet say what the stage shows, and nothing of the cards they replaced.
    const text = Array.from(transcript, (item) => item.textContent ?? '').join(' ');
    expect(text).toContain('Шпаргалка: строки стирают только ответы.');
    expect(text).toContain('Разные дни: одного ответа мало.');
    expect(text).not.toMatch(/карточк|Готовность|Повторение:|в нужный день|твоих/i);
    // The ticket chapter opens a lecture quote; the end names the group and calls to the example.
    expect(transcript[2].textContent).toContain(`«${QUOTE.quote}» (${QUOTE.source})`);
    expect(transcript[transcript.length - 1].textContent).toContain('копия экзамена у каждого в группе');
    expect(transcript[transcript.length - 1].textContent).toContain(`${OUTRO_CTA_LABEL}.`);
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
    expect(SEGMENTS.map((segment) => segment.label)).toEqual(['Начало', 'Билеты', 'Ответ вслух', 'Шпаргалка', 'Разные дни', 'Итог']);
    expect(SEGMENTS[0].from).toBe(0);
    expect(SEGMENTS[SEGMENTS.length - 1].to).toBe(TOTAL);
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Перейти: Ответ вслух' }));
    });
    expect(screen.getByRole('button', { name: 'Перейти: Ответ вслух' })).toHaveAttribute('aria-current', 'step');
    expect(screen.getByRole('button', { name: 'Перейти: Билеты' })).not.toHaveAttribute('aria-current');
  });

  it('keeps only «MELDY» in the corners: no brackets, chapter label, timecode or chapter dots', () => {
    const { container } = render(<MeldyReel />);
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Перейти: Шпаргалка' }));
    });
    expect(container.querySelector('.mr-hud')?.textContent).toBe('MELDY');
    expect(container.querySelectorAll('.mr-hud > *')).toHaveLength(1);
  });

  it('with reduced motion waits on a still frame of the ticket chapter until asked to play', () => {
    reduced = true;
    render(<MeldyReel />);
    showReel(true);
    expect(screen.getByRole('button', { name: 'Смотреть' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: `Перейти: ${CHAPTERS[0].label}` })).toHaveAttribute('aria-current', 'step');
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
