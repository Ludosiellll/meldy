import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { layoutShares, type ShareQuestion } from '../../lib/exams/ticketMath';
import HowCalculated, { upperBoundLead } from './HowCalculated';

function list(total: number, yes: number, maybe = 0, section: (index: number) => number | null = () => null): ShareQuestion[] {
  return Array.from({ length: total }, (_, index) => ({
    id: `q${index + 1}`,
    section: section(index),
    status: index < yes ? 'yes' : index < yes + maybe ? 'maybe' : 'no',
  }));
}

/** The seeded stage list: section 1 has 13 «есть» of 20, section 2 has 11 of 20 (24 of 40 in all). */
const NOT_YES = new Set([3, 5, 8, 9, 14, 17, 19, 22, 24, 26, 29, 33, 35, 37, 38, 40]);
function seeded(): ShareQuestion[] {
  return Array.from({ length: 40 }, (_, index) => ({
    id: `q${index + 1}`,
    section: index < 20 ? 1 : 2,
    status: NOT_YES.has(index + 1) ? 'no' : 'yes',
  }));
}

const plain = (text: string | null | undefined) => (text ?? '').replace(/[\u00a0\u202f]/g, ' ');
function text() {
  return plain(document.body.textContent);
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

  it('shows C²₂₄ / C²₄₀ = 276 / 780 ≈ 35 % and «ни одного с отметкой «есть»: C²₁₆ / C²₄₀ = 120 / 780 ≈ 15 %», «частично» counted as «нет»', () => {
    const shares = layoutShares({ mode: 'random', perTicket: 2, questions: list(40, 24) });
    render(<HowCalculated shares={shares} open onToggle={vi.fn()} id="how" />);
    const formulas = screen.getAllByRole('math');
    expect(plain(formulas[0].getAttribute('aria-label'))).toBe('Сочетания из 24 по 2, делённые на сочетания из 40 по 2: 276 из 780, примерно 35 %');
    expect(plain(formulas[0].textContent)).toContain('276780≈35 %');
    expect(plain(formulas[1].getAttribute('aria-label'))).toBe(
      'Ни одного вопроса с отметкой «есть»: сочетания из 16 по 2, делённые на сочетания из 40 по 2: 120 из 780, примерно 15 %',
    );
    expect(plain(formulas[1].textContent)).toBe('ни одного с отметкой «есть»:C216C240=120780≈15 %');
    expect(text()).toContain(
      '276 — столько пар можно составить из 24 вопросов, которые есть в лекциях; 780 — из всех 40; 120 — из 16 остальных: вопросы «частично» здесь считаются как «нет».',
    );
    expect(text()).not.toContain('хотя бы один');
  });

  it('names triples for three questions per ticket', () => {
    const shares = layoutShares({ mode: 'random', perTicket: 3, questions: list(40, 24) });
    render(<HowCalculated shares={shares} open onToggle={vi.fn()} id="how" />);
    expect(text()).toContain('2 024 — столько троек можно составить из 24 вопросов');
    expect(text()).toContain('560 — из 16 остальных');
  });

  it('says a one-question ticket has the share of the questions', () => {
    const shares = layoutShares({ mode: 'random', perTicket: 1, questions: list(40, 24) });
    render(<HowCalculated shares={shares} open onToggle={vi.fn()} id="how" />);
    expect(text()).toContain('Билет — один вопрос, поэтому доля билетов та же, что и доля вопросов: 24 из 40.');
    expect(plain(screen.getAllByRole('math')[0].textContent)).toContain('2440=60 %');
    expect(screen.getAllByRole('math')).toHaveLength(1);
  });

  it('multiplies the sections for one question from each section: 13/20 × 11/20 ≈ 36 %, none 7/20 × 9/20 ≈ 16 %', () => {
    const shares = layoutShares({ mode: 'sections', perTicket: 2, questions: seeded() });
    render(<HowCalculated shares={shares} open onToggle={vi.fn()} id="how" />);
    const [main, none] = screen.getAllByRole('math').map((formula) => plain(formula.textContent));
    expect(main).toBe('1320×1120≈36 %');
    expect(none).toBe('ни одного с отметкой «есть»:720×920≈16 %');
    expect(text()).toContain(
      'Из каждого раздела берётся один случайный вопрос. В разделе 1 в лекциях есть 13 из 20, в разделе 2 — 11 из 20; 7 и 9 — остальные вопросы этих разделов: вопросы «частично» здесь считаются как «нет».',
    );
  });

  it('counts known tickets directly, «ни одного» included', () => {
    const questions = seeded();
    const tickets = Array.from({ length: 20 }, (_, index) => ({ number: index + 1, questionIds: [`q${index + 1}`, `q${index + 21}`] }));
    const shares = layoutShares({ mode: 'fixed', perTicket: 2, questions, tickets });
    render(<HowCalculated shares={shares} open onToggle={vi.fn()} id="how" />);
    expect(text()).toContain('6 из 20 билетов — все вопросы есть в лекциях; ни одного вопроса с отметкой «есть» — в 2 из 20.');
    expect(text()).toContain('Считаем по списку билетов кафедры');
    expect(text()).toContain('Вопросы «частично» здесь считаются как «нет».');
  });

  it('adds the upper bound when some questions were checked only by words, «ни одного» as a lower bound there', () => {
    const shares = layoutShares({ mode: 'random', perTicket: 2, questions: list(40, 24, 4) });
    render(<HowCalculated shares={shares} open onToggle={vi.fn()} id="how" unknown={{ unverified: 4, unmapped: 0 }} />);
    expect(text()).toContain('Если вопросы, проверенные только по словам, тоже есть в лекциях:');
    const formulas = screen.getAllByRole('math').map((formula) => plain(formula.textContent));
    expect(formulas.some((formula) => formula.startsWith('не больше') && formula.includes('378780≈48 %'))).toBe(true);
    // 12 questions left without «есть» in the upper bound: C(12, 2) = 66 of 780.
    expect(formulas.some((formula) => formula.startsWith('ни одного с отметкой «есть»:не меньше') && formula.includes('66780≈8 %'))).toBe(true);
    expect(upperBoundLead({ unverified: 0, unmapped: 3 })).toBe('Если ещё не сверенные вопросы тоже есть в лекциях:');
    expect(upperBoundLead({ unverified: 2, unmapped: 3 })).toBe('Если вопросы, проверенные только по словам, и ещё не сверенные тоже есть в лекциях:');
  });

  it('keeps the upper bound for sections and known tickets too', () => {
    const questions = seeded().map((question, index) => (index < 2 ? { ...question, status: 'maybe' as const } : question));
    const sections = layoutShares({ mode: 'sections', perTicket: 2, questions });
    const first = render(<HowCalculated shares={sections} open onToggle={vi.fn()} id="how" />);
    expect(screen.getAllByRole('math').some((formula) => plain(formula.textContent).startsWith('не больше'))).toBe(true);
    first.unmount();
    const tickets = Array.from({ length: 20 }, (_, index) => ({ number: index + 1, questionIds: [`q${index + 1}`, `q${index + 21}`] }));
    render(<HowCalculated shares={layoutShares({ mode: 'fixed', perTicket: 2, questions, tickets })} open onToggle={vi.fn()} id="how" />);
    expect(text()).toMatch(/Не больше \d+ из 20 билетов — все вопросы есть в лекциях; ни одного вопроса с отметкой «есть» — не меньше чем в \d+ из 20\./);
  });

  it('keeps the action line right under the link, closed or open, and the formula below it', () => {
    const shares = layoutShares({ mode: 'random', perTicket: 2, questions: list(40, 24) });
    const action = <p data-testid="action">Закройте 7 вопросов «частично»</p>;
    const { rerender } = render(<HowCalculated shares={shares} open={false} onToggle={vi.fn()} id="how" after={action} />);
    const link = screen.getByRole('button', { name: 'Как считается' });
    expect(link.nextElementSibling).toBe(screen.getByTestId('action'));
    rerender(<HowCalculated shares={shares} open onToggle={vi.fn()} id="how" after={action} assumption="Это доля билетов, а не вероятность сдать: считаем, что билет — два случайных вопроса из 40." />);
    expect(link.nextElementSibling).toBe(screen.getByTestId('action'));
    const calc = document.getElementById('how') as HTMLElement;
    expect(screen.getByTestId('action').compareDocumentPosition(calc) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // The full assumption opens the formula (the low window shows the short caveat above).
    expect(calc.firstElementChild).toHaveTextContent('считаем, что билет — два случайных вопроса из 40.');
  });

  it('explains why sections fell back to random tickets', () => {
    const shares = layoutShares({ mode: 'sections', perTicket: 2, questions: list(9, 5, 0, (index) => (index % 3) + 1) });
    render(<HowCalculated shares={shares} open onToggle={vi.fn()} id="how" />);
    expect(text()).toContain('Разделов в списке 3, а вопросов в билете 2');
    expect(text()).toContain('Поэтому считаем как для случайных билетов.');
  });
});
