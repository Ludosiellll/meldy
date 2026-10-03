import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { layoutShares, type ShareQuestion } from '../../lib/exams/ticketMath';
import HowCalculated from './HowCalculated';

function list(total: number, yes: number, maybe = 0, section: (index: number) => number | null = () => null): ShareQuestion[] {
  return Array.from({ length: total }, (_, index) => ({
    id: `q${index + 1}`,
    section: section(index),
    status: index < yes ? 'yes' : index < yes + maybe ? 'maybe' : 'no',
  }));
}

function text() {
  return document.body.textContent?.replace(/ /g, ' ') ?? '';
}

afterEach(() => {
  cleanup();
});

describe('HowCalculated', () => {
  it('is a link that opens and closes the formula', () => {
    const onToggle = vi.fn();
    const shares = layoutShares({ mode: 'random', perTicket: 2, questions: list(40, 24) });
    const { rerender } = render(<HowCalculated shares={shares} open={false} onToggle={onToggle} id="how" />);
    const toggle = screen.getByRole('button', { name: 'Как считается' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('math')).toBeNull();
    fireEvent.click(toggle);
    expect(onToggle).toHaveBeenCalledTimes(1);
    rerender(<HowCalculated shares={shares} open onToggle={onToggle} id="how" />);
    expect(screen.getByRole('button', { name: 'Как считается' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('shows C²₂₄ / C²₄₀ = 276 / 780 ≈ 35 % and «хотя бы один: 1 − 120 / 780 ≈ 85 %» with the explanation', () => {
    const shares = layoutShares({ mode: 'random', perTicket: 2, questions: list(40, 24) });
    render(<HowCalculated shares={shares} open onToggle={vi.fn()} id="how" />);
    const formulas = screen.getAllByRole('math');
    expect(formulas[0]).toHaveAccessibleName('Сочетания из 24 по 2, делённые на сочетания из 40 по 2: 276 из 780, примерно 35 %');
    expect(formulas[0].textContent?.replace(/ /g, ' ')).toContain('276780≈35 %');
    expect(formulas[1].textContent?.replace(/ /g, ' ')).toContain('хотя бы один:1−120780≈85 %');
    expect(text()).toContain('276 — столько пар можно составить из 24 вопросов, которые есть в лекциях; 780 — из всех 40; 120 — из 16 остальных.');
  });

  it('names triples for three questions per ticket', () => {
    const shares = layoutShares({ mode: 'random', perTicket: 3, questions: list(40, 24) });
    render(<HowCalculated shares={shares} open onToggle={vi.fn()} id="how" />);
    expect(text()).toContain('2 024 — столько троек можно составить из 24 вопросов');
  });

  it('says a one-question ticket has the share of the questions', () => {
    const shares = layoutShares({ mode: 'random', perTicket: 1, questions: list(40, 24) });
    render(<HowCalculated shares={shares} open onToggle={vi.fn()} id="how" />);
    expect(text()).toContain('Билет — один вопрос, поэтому доля билетов та же, что и доля вопросов: 24 из 40.');
    expect(screen.getAllByRole('math')[0].textContent?.replace(/ /g, ' ')).toContain('2440=60 %');
  });

  it('multiplies the sections for one question from each section (14/20 × 10/20)', () => {
    const questions = list(40, 0).map((question, index) => ({
      ...question,
      section: index < 20 ? 1 : 2,
      status: (index < 14 || (index >= 20 && index < 30) ? 'yes' : 'no') as ShareQuestion['status'],
    }));
    const shares = layoutShares({ mode: 'sections', perTicket: 2, questions });
    render(<HowCalculated shares={shares} open onToggle={vi.fn()} id="how" />);
    const first = screen.getAllByRole('math')[0].textContent?.replace(/ /g, ' ');
    expect(first).toBe('1420×1020=35 %');
    expect(text()).toContain('в разделе 1 в лекциях есть 14 из 20; в разделе 2 в лекциях есть 10 из 20');
  });

  it('counts known tickets directly', () => {
    const questions = list(40, 24);
    const tickets = Array.from({ length: 20 }, (_, index) => ({ number: index + 1, questionIds: [`q${index + 1}`, `q${index + 21}`] }));
    const shares = layoutShares({ mode: 'fixed', perTicket: 2, questions, tickets });
    render(<HowCalculated shares={shares} open onToggle={vi.fn()} id="how" />);
    expect(text()).toContain('4 из 20 билетов — все вопросы есть в лекциях; хотя бы один — 20 из 20.');
    expect(text()).toContain('Считаем по списку билетов кафедры');
  });

  it('adds the upper bound when some questions were checked only by words', () => {
    const shares = layoutShares({ mode: 'random', perTicket: 2, questions: list(40, 24, 4) });
    render(<HowCalculated shares={shares} open onToggle={vi.fn()} id="how" />);
    expect(text()).toContain('Если вопросы, проверенные только по словам, тоже есть в лекциях:');
    const formulas = screen.getAllByRole('math').map((formula) => formula.textContent?.replace(/ /g, ' '));
    expect(formulas.some((formula) => formula?.startsWith('не больше') && formula.includes('378780≈48 %'))).toBe(true);
  });

  it('explains why sections fell back to random tickets', () => {
    const shares = layoutShares({ mode: 'sections', perTicket: 2, questions: list(9, 5, 0, (index) => (index % 3) + 1) });
    render(<HowCalculated shares={shares} open onToggle={vi.fn()} id="how" />);
    expect(text()).toContain('Разделов в списке 3, а вопросов в билете 2');
    expect(text()).toContain('Поэтому считаем как для случайных билетов.');
  });
});
