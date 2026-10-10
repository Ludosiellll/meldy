import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import HeroSheet, {
  HERO_SHEET,
  LEFT_AFTER,
  LEFT_BEFORE,
  MAP_LEGEND,
  REPLAY_LABEL,
  SHEET_CHANGE,
  SHEET_EXAMPLE,
  SHEET_REPLAY_EVENT,
  SHEET_RULE,
  SHEET_TITLE,
  SHEET_TOTAL,
  STRIKE_MS,
  leftWords,
} from './HeroSheet';
import { EXAMPLE_QUESTIONS } from '../../data/example';
import { SHEET_RULE as EXAM_PAGE_RULE, changeSentence, counterLabel } from '../exams/sheet/copy';
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
const LOOK = { fresh: 'left', returned: 'left', rubbed: 'once', erased: 'gone' } as const;
const looks = (container: HTMLElement) => Array.from(container.querySelectorAll('.hs-line')).map((line) => line.getAttribute('data-look'));
const moving = (container: HTMLElement) => Array.from(container.querySelectorAll('.hs-line')).map((line) => line.hasAttribute('data-moving'));
const lines = HERO_SHEET.flatMap((question) => question.lines);
const squares = (container: HTMLElement) => Array.from(container.querySelectorAll('.hs-map > i')).map((square) => square.getAttribute('data-look'));

/** Each step of the play is scheduled once the previous one has rendered. */
const playThrough = () => {
  act(() => {
    vi.advanceTimersByTime(1600);
  });
  act(() => {
    vi.advanceTimersByTime(STRIKE_MS + 1000);
  });
};

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

  it('maps every line of the example\'s sheet: one square per point of questions 1–12', () => {
    const { container } = render(<HeroSheet />);
    expect(SHEET_TOTAL).toBe(EXAMPLE_QUESTIONS.reduce((sum, question) => sum + question.points.length, 0));
    expect(container.querySelectorAll('.hs-map > i')).toHaveLength(SHEET_TOTAL);
    // The number of lines left in the exam page's words, one fewer once the answer has erased a line.
    expect(LEFT_AFTER).toBe(LEFT_BEFORE - 1);
    expect(leftWords(LEFT_BEFORE, SHEET_TOTAL)).toBe(counterLabel({ left: LEFT_BEFORE, total: SHEET_TOTAL }));
    expect(leftWords(41, 47)).toBe(counterLabel({ left: 41, total: 47 }));
    expect(leftWords(23, 47)).toBe(counterLabel({ left: 23, total: 47 }));
    expect(MAP_LEGEND.map((item) => item.text)).toEqual(['осталось', 'названо один раз', 'стёрто']);
  });

  it('says what the answer did in the words of the exam page, and keeps its rule', () => {
    const changes: LineChange[] = lines
      .filter((line) => line.before !== line.after)
      .map((line, index) => ({ key: String(index), questionId: 'q', from: line.before, to: line.after }));
    // Word for word, no-break spaces included.
    expect(changeSentence(changeSummary(changes))).toBe(SHEET_CHANGE);
    expect(SHEET_RULE).toBe(EXAM_PAGE_RULE);
  });

  it('is a figure named by its flag; the picture is hidden from screen readers, a description says the same', () => {
    const { container } = render(<HeroSheet />);
    expect(screen.getByRole('figure', { name: SHEET_TITLE })).toBeInTheDocument();
    expect(container.querySelector('.hs-pic')).toHaveAttribute('aria-hidden', 'true');
    expect(container.querySelector('.sr-only')?.textContent).toContain('Микроэкономика');
    expect(plain(container.querySelector('figcaption')?.textContent)).toContain(plain(SHEET_CHANGE));
    expect(container.querySelectorAll('.hs-line')).toHaveLength(lines.length);
  });

  it('has no paper: no handwriting, squared grid, pencil marks or eraser, the words are plain text', () => {
    const { container } = render(<HeroSheet />);
    expect(container.querySelector('.hs-paper, .hs-patch, .hs-tick, .cs-arrow-ink, svg')).toBeNull();
    expect(plain(container.querySelector('.hs-list')?.textContent)).toContain('выручка = цена × количество');
  });

  it('named by a heading of the page, it says only which example it is', () => {
    const { container } = render(
      <>
        <h2 id="sheet-h">Сотни вопросов — один план</h2>
        <HeroSheet labelledBy="sheet-h" />
      </>,
    );
    expect(screen.getByRole('figure', { name: `Сотни вопросов — один план ${SHEET_EXAMPLE}` })).toBeInTheDocument();
    expect(container.querySelector('.hs-flag')?.textContent).toBe(SHEET_EXAMPLE);
    expect(container.querySelector('.hs-meta')).toBeNull();
  });

  it('plays one answer once in view: the line named before is struck off, two turn yellow, the map follows, then it says so', () => {
    const { container } = render(<HeroSheet />);
    expect(looks(container)).toEqual(lines.map((line) => LOOK[line.before]));
    expect(container.querySelector('.hs-change')).not.toHaveAttribute('data-shown');
    expect(screen.getByRole('button', { name: REPLAY_LABEL })).toBeDisabled();
    const before = squares(container);

    act(() => {
      vi.advanceTimersByTime(1600);
    });
    expect(container.querySelector('.hs')).toHaveAttribute('data-phase', 'playing');
    expect(looks(container)).toEqual(lines.map((line) => LOOK[line.after]));
    expect(moving(container)).toEqual(lines.map((line) => line.before !== line.after));
    // The map changes with the same lines, and only them: one square empties, two turn yellow.
    const after = squares(container);
    const changed = after.map((look, index) => [before[index], look]).filter(([was, now]) => was !== now);
    expect(changed).toEqual([
      ['once', 'gone'],
      ['left', 'once'],
      ['left', 'once'],
    ]);
    // The strike first, then the namings one after the other.
    const delays = Array.from(container.querySelectorAll<HTMLElement>('.hs-line[data-moving]')).map((line) => parseInt(line.style.getPropertyValue('--hs-delay'), 10));
    expect(delays[0]).toBe(0);
    expect(delays[1]).toBeGreaterThan(0);
    expect(delays[2]).toBeGreaterThan(delays[1]);

    act(() => {
      vi.advanceTimersByTime(STRIKE_MS + 1000);
    });
    expect(container.querySelector('.hs')).toHaveAttribute('data-phase', 'after');
    expect(container.querySelector('.hs-change')).toHaveAttribute('data-shown');
    // The line that came back keeps its note.
    expect(plain(container.querySelector('.hs-line .hs-note')?.textContent)).toBe('была стёрта · пункт не назван');

    fireEvent.click(screen.getByRole('button', { name: REPLAY_LABEL }));
    expect(looks(container)).toEqual(lines.map((line) => LOOK[line.before]));
    expect(moving(container).every((value) => !value)).toBe(true);
    expect(container.querySelector('.hs-change')).not.toHaveAttribute('data-shown');
    act(() => {
      vi.advanceTimersByTime(700);
    });
    expect(moving(container).filter(Boolean)).toHaveLength(3);
  });

  it('plays again when another part of the page asks', () => {
    const { container } = render(<HeroSheet />);
    playThrough();
    expect(container.querySelector('.hs-change')).toHaveAttribute('data-shown');
    act(() => {
      window.dispatchEvent(new CustomEvent(SHEET_REPLAY_EVENT));
    });
    expect(looks(container)).toEqual(lines.map((line) => LOOK[line.before]));
    expect(container.querySelector('.hs-change')).not.toHaveAttribute('data-shown');
    playThrough();
    expect(looks(container)).toEqual(lines.map((line) => LOOK[line.after]));
    expect(container.querySelector('.hs-change')).toHaveAttribute('data-shown');
  });

  it('under reduced motion stands as after the answer, with nothing moving and no replay', () => {
    reduce = true;
    const { container } = render(<HeroSheet />);
    expect(looks(container)).toEqual(lines.map((line) => LOOK[line.after]));
    expect(container.querySelector('.hs')).toHaveAttribute('data-phase', 'after');
    expect(container.querySelector('.hs-change')).toHaveAttribute('data-shown');
    expect(screen.queryByRole('button', { name: REPLAY_LABEL })).toBeNull();
    act(() => {
      window.dispatchEvent(new CustomEvent(SHEET_REPLAY_EVENT));
      vi.advanceTimersByTime(5000);
    });
    expect(container.querySelector('.hs')).toHaveAttribute('data-phase', 'after');
  });
});
