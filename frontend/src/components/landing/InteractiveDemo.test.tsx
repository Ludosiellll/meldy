import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import InteractiveDemo from './InteractiveDemo';
import { DEMO_SHEET, QUIZ, THESES } from './lecture';

const plain = (s: string | null | undefined) => (s ?? '').replace(/\u00A0/g, ' ');

describe('InteractiveDemo', () => {
  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  it('shows the summary and the quiz together, with no tabs and nothing that plays by itself', () => {
    vi.useFakeTimers();
    const { container } = render(<InteractiveDemo />);
    expect(screen.queryAllByRole('tab')).toHaveLength(0);
    expect(screen.getByRole('heading', { level: 3, name: 'Конспект' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'Вопрос теста' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Перевернуть карточку' })).not.toBeInTheDocument();
    const before = container.innerHTML;
    act(() => { vi.advanceTimersByTime(20000); });
    expect(container.innerHTML).toBe(before);
  });

  it('points each thesis at its sentence in the lecture', () => {
    const { container } = render(<InteractiveDemo />);
    const theses = THESES.map(t => screen.getByRole('button', { name: new RegExp(`^${plain(t).replace(/[|\\{}()[\]^$+*?.]/g, '\\$&').replace(/ /g, '\\s')}$`) }));
    expect(theses[1]).toHaveAttribute('aria-pressed', 'true');
    expect(plain(container.querySelector('[data-source="active"]')?.textContent)).toBe(plain(DEMO_SHEET.sources[1]));
    fireEvent.click(theses[0]);
    expect(theses[0]).toHaveAttribute('aria-pressed', 'true');
    expect(theses[1]).toHaveAttribute('aria-pressed', 'false');
    expect(container.querySelectorAll('[data-source="active"]')).toHaveLength(1);
    expect(plain(container.querySelector('[data-source="active"]')?.textContent)).toBe(plain(DEMO_SHEET.sources[0]));
  });

  it('moves the pencil: the old marks fade while the new ones draw', () => {
    vi.useFakeTimers();
    const { container } = render(<InteractiveDemo />);
    fireEvent.click(screen.getAllByRole('button', { pressed: false })[0]);
    const states = () => Array.from(container.querySelectorAll('.lp-sheet-marks')).map(el => el.getAttribute('class'));
    // jsdom measures every word at 0×0, so a source may have no strokes; the layers are what matters
    for (const cls of states()) expect(cls).toMatch(/is-(fade|draw|still)/);
    act(() => { vi.advanceTimersByTime(200); });
    expect(states().every(cls => !/is-fade/.test(cls ?? ''))).toBe(true);
  });

  it('answers the quiz with a drawn tick and an explanation, never a library icon', () => {
    const { container } = render(<InteractiveDemo />);
    expect(screen.getByText(plain(QUIZ.question).replace(/ /g, ' '), { normalizer: plain })).toBeInTheDocument();
    const right = screen.getByRole('button', { name: QUIZ.options[QUIZ.correct] });
    fireEvent.click(right);
    expect(right).toHaveClass('is-correct');
    expect(right).toHaveAttribute('aria-pressed', 'true');
    expect(right.querySelector('.lp-tick path')).not.toBeNull();
    expect(screen.getByText(/^Верно:/)).toBeInTheDocument();
    expect(container.querySelector('svg.lucide')).toBeNull();

    const wrong = screen.getByRole('button', { name: QUIZ.options[0] });
    fireEvent.click(wrong);
    expect(wrong).toHaveClass('is-wrong');
    expect(wrong.querySelector('.lp-tick')).toBeNull();
    expect(screen.getByText(/^Посчитайте:/)).toBeInTheDocument();
  });

  it('keeps room for the explanation so answering does not move the page', () => {
    const { container } = render(<InteractiveDemo />);
    const slot = container.querySelector('.lp-feedback-slot');
    expect(slot).not.toBeNull();
    expect(slot).toHaveAttribute('aria-live', 'polite');
    expect(slot?.textContent).toBe('');
  });
});
