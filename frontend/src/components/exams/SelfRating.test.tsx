import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import SelfRating from './SelfRating';

afterEach(() => {
  cleanup();
});

describe('SelfRating', () => {
  it('offers «знаю · плаваю · не знаю» as a group of pressed buttons for one question', () => {
    render(<SelfRating value="unsure" onChange={vi.fn()} questionLabel="вопрос 17" seedKey="exam-1:17" />);
    const group = screen.getByRole('group', { name: 'Самооценка, вопрос 17' });
    const buttons = within(group).getAllByRole('button');
    expect(buttons.map((button) => button.textContent)).toEqual(['знаю', 'плаваю', 'не знаю']);
    expect(within(group).getByRole('button', { name: 'плаваю' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(group).getByRole('button', { name: 'знаю' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('underlines the chosen word in graphite, the student’s own hand', () => {
    const { container } = render(<SelfRating value="know" onChange={vi.fn()} questionLabel="вопрос 2" seedKey="exam-1:2" />);
    const mark = container.querySelector('[aria-pressed="true"] [data-mark="under"] svg');
    expect(mark).not.toBeNull();
    expect(mark).toHaveClass('sf-mark-graphite');
    expect(mark).toHaveAttribute('aria-hidden', 'true');
  });

  it('changes the rating with one tap and ignores a tap on the current one', () => {
    const onChange = vi.fn();
    render(<SelfRating value="know" onChange={onChange} questionLabel="вопрос 3" seedKey="exam-1:3" />);
    fireEvent.click(screen.getByRole('button', { name: 'знаю' }));
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'не знаю' }));
    expect(onChange).toHaveBeenCalledWith('dont_know');
  });

  it('can rate a question that had no rating yet, and cannot remove a rating', () => {
    const onChange = vi.fn();
    render(<SelfRating value={null} onChange={onChange} questionLabel="вопрос 4" seedKey="exam-1:4" />);
    for (const button of screen.getAllByRole('button')) expect(button).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(screen.getByRole('button', { name: 'знаю' }));
    expect(onChange).toHaveBeenCalledWith('know');
    expect(screen.queryByRole('button', { name: /снять|убрать/i })).toBeNull();
  });

  it('waits while saving and shows a failed save next to the question', () => {
    render(<SelfRating value="know" onChange={vi.fn()} questionLabel="вопрос 5" seedKey="exam-1:5" pending error="Отметка не сохранена. Повторите." />);
    for (const button of screen.getAllByRole('button')) expect(button).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('Отметка не сохранена. Повторите.');
  });
});
