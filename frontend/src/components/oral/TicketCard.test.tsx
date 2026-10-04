import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import TicketCard, { ticketHeading } from './TicketCard';

afterEach(() => {
  cleanup();
});

describe('<TicketCard>', () => {
  it('names a department ticket «Билет 12 · вопрос 1 из 2»', () => {
    expect(ticketHeading('12', 0, 2, '7')).toEqual({ strong: 'Билет 12', rest: 'вопрос 1 из 2' });
    expect(ticketHeading('7', 0, 1, '3')).toEqual({ strong: 'Билет 7', rest: '' });
    render(<TicketCard heading={ticketHeading('12', 0, 2, '7')} question="Как обучается нейронная сеть?" />);
    expect(screen.getByRole('heading', { level: 1, name: 'Как обучается нейронная сеть?' })).toBeInTheDocument();
    const card = screen.getByRole('article', { name: 'Билет 12, вопрос 1 из 2' });
    expect(card.querySelector('.or-ticket-no')?.textContent?.replace(/\s+/g, ' ')).toBe('Билет 12 · вопрос 1 из 2');
  });

  it('keeps the question’s own number for a random pair, or says «Случайный билет» without one (redesign critique 8)', () => {
    expect(ticketHeading(null, 1, 2, '7')).toEqual({ strong: 'Вопрос 7', rest: '2 из 2' });
    expect(ticketHeading(null, 0, 2, '12.')).toEqual({ strong: 'Вопрос 12', rest: '1 из 2' });
    expect(ticketHeading(null, 0, 2, '')).toEqual({ strong: 'Случайный билет', rest: 'вопрос 1 из 2' });
    render(<TicketCard heading={ticketHeading(null, 0, 2, '12')} question="Эластичность спроса" />);
    expect(screen.getByRole('article', { name: 'Вопрос 12, 1 из 2' }).querySelector('.or-ticket-no')?.textContent?.replace(/\s+/g, ' ')).toBe(
      'Вопрос 12 · 1 из 2',
    );
  });

  it('names a single question by its number, and never says «Билет» without the department’s ticket', () => {
    expect(ticketHeading(null, 0, 1, '17')).toEqual({ strong: 'Вопрос 17', rest: '' });
    expect(ticketHeading(null, 0, 1, '')).toEqual({ strong: 'Вопрос', rest: '' });
    render(<TicketCard heading={ticketHeading(null, 0, 1, '17')} question="Инфляция издержек" />);
    const card = screen.getByRole('article', { name: 'Вопрос 17' });
    expect(card.textContent).not.toMatch(/Билет/);
  });
});
