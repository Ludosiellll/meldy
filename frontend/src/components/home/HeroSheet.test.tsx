import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import HeroSheet, { HERO_SHEET, REPLAY_LABEL, SHEET_CHANGE, SHEET_REPLAY_EVENT, SHEET_RULE, SHEET_TITLE, SWEEP_MS } from './HeroSheet';
import { EXAMPLE_QUESTIONS } from '../../data/example';
import { SHEET_RULE as EXAM_PAGE_RULE, changeSentence } from '../exams/sheet/copy';
import { changeSummary, type LineChange } from '../../lib/exams/cheatSheet';

let reduce = false;

/** Reports the sheet in view as soon as it is observed. */
class SeenObserver {
  constructor(private callback: (entries: Array<{ isIntersecting: boolean; intersectionRatio: number }>) => void) {}
  observe() {
    this.callback([{ isIntersecting: true, intersectionRatio: 1 }]);
  }
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}

beforeEach(() => {
  reduce = false;
  vi.useFakeTimers();
  vi.stubGlobal('IntersectionObserver', SeenObserver);
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('reduce') ? reduce : false,
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
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const plain = (text: string | null | undefined) => (text ?? '').replace(/\s+/g, ' ').trim();
const states = (container: HTMLElement) => Array.from(container.querySelectorAll('.hs-line')).map((line) => line.getAttribute('data-state'));
const anims = (container: HTMLElement) => Array.from(container.querySelectorAll('.hs-line')).map((line) => line.getAttribute('data-anim'));
const lines = HERO_SHEET.flatMap((question) => question.lines);

describe('HeroSheet', () => {
  it('draws questions 6 and 7 of the example exam (/try), their lines word for word', () => {
    for (const question of HERO_SHEET) {
      const example = EXAMPLE_QUESTIONS.find((item) => item.number === question.number)!;
      expect(question.text).toBe(example.text);
      expect(question.lines.map((line) => [line.text, line.essential])).toEqual(example.points.map((point) => [point.short, point.essential]));
    }
    // A learned question: every main line erased.
    for (const question of HERO_SHEET.filter((item) => item.learned)) {
      expect(question.lines.filter((line) => line.essential).every((line) => line.after === 'erased')).toBe(true);
    }
  });

  it('says what the answer did in the words of the exam page, and keeps its rule', () => {
    const changes: LineChange[] = lines
      .filter((line) => line.before !== line.after)
      .map((line, index) => ({ key: String(index), questionId: 'q', from: line.before, to: line.after }));
    // Word for word, no-break spaces included.
    expect(changeSentence(changeSummary(changes))).toBe(SHEET_CHANGE);
    expect(SHEET_RULE).toBe(EXAM_PAGE_RULE);
  });

  it('is a figure named by its flag; the paper is a picture, the words under it are text', () => {
    const { container } = render(<HeroSheet />);
    expect(screen.getByRole('figure', { name: SHEET_TITLE })).toBeInTheDocument();
    expect(container.querySelector('.hs-paper')).toHaveAttribute('aria-hidden', 'true');
    expect(container.querySelector('.sr-only')?.textContent).toContain('Микроэкономика');
    expect(plain(container.querySelector('figcaption')?.textContent)).toContain(plain(SHEET_CHANGE));
    expect(container.querySelectorAll('.hs-line')).toHaveLength(lines.length);
    // The arrows are drawn in ink, the characters stay for copying and screen readers.
    expect(container.querySelectorAll('.cs-arrow-ink').length).toBeGreaterThan(0);
  });

  it('plays one answer once in view: the line named before is erased, two rub half away, then it says so', () => {
    const { container } = render(<HeroSheet />);
    expect(states(container)).toEqual(lines.map((line) => line.before));
    expect(container.querySelector('.hs-change')).not.toHaveAttribute('data-shown');
    expect(screen.getByRole('button', { name: REPLAY_LABEL })).toBeDisabled();

    act(() => {
      vi.advanceTimersByTime(1600);
    });
    expect(states(container)).toEqual(lines.map((line) => line.after));
    expect(anims(container)).toEqual(lines.map((line) => (line.before === line.after ? null : line.after === 'erased' ? 'erase' : 'rub')));

    act(() => {
      vi.advanceTimersByTime(2 * 320 + SWEEP_MS + 100);
    });
    expect(anims(container).every((anim) => anim === null)).toBe(true);
    expect(container.querySelector('.hs-change')).toHaveAttribute('data-shown');
    // The line that came back keeps its wave and its pencil note.
    expect(container.querySelector('.hs-line[data-state="returned"] .hs-note')?.textContent).toBe('была стёрта · пункт не назван');

    fireEvent.click(screen.getByRole('button', { name: REPLAY_LABEL }));
    expect(states(container)).toEqual(lines.map((line) => line.before));
    expect(container.querySelector('.hs-change')).not.toHaveAttribute('data-shown');
    act(() => {
      vi.advanceTimersByTime(700);
    });
    expect(anims(container).filter(Boolean)).toHaveLength(3);
  });

  /** Each step of the play is scheduled once the previous one has rendered. */
  const playThrough = () => {
    act(() => {
      vi.advanceTimersByTime(1600);
    });
    act(() => {
      vi.advanceTimersByTime(2 * 320 + SWEEP_MS + 100);
    });
  };

  it('plays again when another part of the page asks', () => {
    const { container } = render(<HeroSheet />);
    playThrough();
    expect(container.querySelector('.hs-change')).toHaveAttribute('data-shown');
    act(() => {
      window.dispatchEvent(new CustomEvent(SHEET_REPLAY_EVENT));
    });
    expect(states(container)).toEqual(lines.map((line) => line.before));
    expect(container.querySelector('.hs-change')).not.toHaveAttribute('data-shown');
    playThrough();
    expect(states(container)).toEqual(lines.map((line) => line.after));
    expect(container.querySelector('.hs-change')).toHaveAttribute('data-shown');
  });

  it('under reduced motion stands as after the answer, with no animation and no replay', () => {
    reduce = true;
    const { container } = render(<HeroSheet />);
    expect(states(container)).toEqual(lines.map((line) => line.after));
    expect(anims(container).every((anim) => anim === null)).toBe(true);
    expect(container.querySelector('.hs-change')).toHaveAttribute('data-shown');
    expect(screen.queryByRole('button', { name: REPLAY_LABEL })).toBeNull();
    act(() => {
      window.dispatchEvent(new CustomEvent(SHEET_REPLAY_EVENT));
      vi.advanceTimersByTime(5000);
    });
    expect(anims(container).every((anim) => anim === null)).toBe(true);
  });
});
