import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import MockSetup, { defaultCount, mockCounts } from './MockSetup';

afterEach(cleanup);

/**
 * «Как на экзамене»: the setup sheet (usability check of 2026-10-10, M2). Its two lists stood inside the sheet's own
 * scroll and most sizes and times could not be tapped; now each list stands in the window, so every choice is there.
 */
describe('«Как на экзамене» setup', () => {
  it('offers every size up to the questions with a key, and the subject’s whole count under 100', () => {
    expect(mockCounts(240)).toEqual([10, 20, 30, 40, 50, 60, 80, 100]);
    expect(mockCounts(57)).toEqual([10, 20, 30, 40, 50, 57]);
    expect(defaultCount(240)).toBe(40);
    expect(defaultCount(25)).toBe(25);
  });

  it('every size and every time can be chosen, the last ones too, and «Начать» takes them', () => {
    const onStart = vi.fn();
    render(<MockSetup keyed={240} last={null} onClose={() => undefined} onStart={onStart} />);
    const sheet = screen.getByRole('dialog', { name: 'Как на экзамене' });
    const count = within(sheet).getByRole('combobox', { name: 'Вопросов' });
    fireEvent.click(count);
    const sizes = within(sheet).getAllByRole('option');
    expect(sizes.map((option) => option.textContent)).toEqual(['10', '20', '30', '40', '50', '60', '80', '100']);
    fireEvent.click(sizes[sizes.length - 1]);
    expect(count).toHaveTextContent('100');

    // A minute a question by default: 100 questions → 120 minutes; «без времени» is the last choice.
    const minutes = within(sheet).getByRole('combobox', { name: 'Минут' });
    expect(minutes).toHaveTextContent('120');
    fireEvent.click(minutes);
    const times = within(sheet).getAllByRole('option');
    expect(times.map((option) => option.textContent)).toEqual(['10', '15', '20', '30', '40', '45', '60', '80', '90', '120', 'без времени']);
    fireEvent.click(times[times.length - 1]);
    expect(minutes).toHaveTextContent('без времени');

    fireEvent.click(within(sheet).getByRole('button', { name: 'Начать' }));
    expect(onStart).toHaveBeenCalledWith(100, 0);
  });

  it('from the keyboard: the list of times opens, End reaches «без времени», Enter takes it, Escape keeps the sheet', () => {
    const onClose = vi.fn();
    render(<MockSetup keyed={240} last={null} onClose={onClose} onStart={() => undefined} />);
    const minutes = screen.getByRole('combobox', { name: 'Минут' });
    minutes.focus();
    fireEvent.keyDown(minutes, { key: 'ArrowDown' });
    fireEvent.keyDown(minutes, { key: 'End' });
    expect(document.getElementById(minutes.getAttribute('aria-activedescendant') ?? '')).toHaveTextContent('без времени');
    fireEvent.keyDown(minutes, { key: 'Enter' });
    expect(minutes).toHaveTextContent('без времени');
    fireEvent.keyDown(minutes, { key: 'ArrowDown' });
    fireEvent.keyDown(minutes, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Как на экзамене' })).toBeInTheDocument();
  });
});
