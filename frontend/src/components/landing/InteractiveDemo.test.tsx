import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import InteractiveDemo from './InteractiveDemo';

describe('InteractiveDemo', () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('shows three tabs that match the steps and does not advance by itself', () => {
    vi.useFakeTimers();
    render(<InteractiveDemo />);

    const tabs = screen.getAllByRole('tab');
    expect(tabs.map(tab => tab.textContent)).toEqual(['1Конспект', '2Карточка', '3Тест']);
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByRole('button', { name: /демо/ })).not.toBeInTheDocument();

    act(() => { vi.advanceTimersByTime(20000); });
    expect(screen.getAllByRole('tab')[0]).toHaveAttribute('aria-selected', 'true');
  });

  it('links summary rows to the source fragment', () => {
    render(<InteractiveDemo />);
    const row = screen.getByRole('button', { name: /Знакомый текст — ещё не выученный/ });
    expect(row).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(row);
    expect(row).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Знакомый текст легко принять за усвоенный.', { exact: false })).toHaveClass('sf-highlight');
  });

  it('moves between tabs with the arrow keys and keeps the card and quiz interactive', async () => {
    render(<InteractiveDemo />);
    const [first] = screen.getAllByRole('tab');

    fireEvent.keyDown(first, { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'Карточка' })).toHaveAttribute('aria-selected', 'true');
    const card = await screen.findByRole('button', { name: 'Открыть ответ на карточке' });
    fireEvent.click(card);
    expect(card).toHaveAttribute('aria-pressed', 'true');

    fireEvent.keyDown(screen.getByRole('tab', { name: 'Карточка' }), { key: 'End' });
    expect(screen.getByRole('tab', { name: 'Тест' })).toHaveAttribute('aria-selected', 'true');
    const correct = await screen.findByRole('button', { name: /Закрыть конспект и объяснить тему/ });
    fireEvent.click(correct);
    expect(correct).toHaveClass('is-correct');
    expect(screen.getByText(/Верно\./)).toBeInTheDocument();
  });
});
