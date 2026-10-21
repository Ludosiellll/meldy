import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import SourceReferences from './SourceReferences';

afterEach(cleanup);

const sources = [
  { id: 'S01', text: 'Обучение нейронной сети\nОбучение сети заключается в подборе весов и смещений по данным.' },
  { id: 'S02', text: 'Рост ВВП в номинальном выражении по итогам года составил\n7 % при инфляции около пяти процентов, что выше прогноза.' },
];

function open(ids: string[], note?: string) {
  render(
    <div className="card">
      <SourceReferences ids={ids} sources={sources} note={note} />
    </div>,
  );
  fireEvent.click(screen.getByRole('button', { name: /Ближайшие фрагменты лекции/ }));
  return screen.getByRole('dialog');
}

describe('SourceReferences opens the fragments in the panel, not inside the card (owner 21.10)', () => {
  it('opens the panel beside the page and leaves the card as it was', () => {
    const panel = open(['S01'], 'Здесь в лекции больше всего общих слов с карточкой.');
    expect(panel).toHaveAccessibleName('Фрагмент 1 лекции');
    expect(document.querySelector('.card .sf-slip')).toBeNull();
    expect(within(panel).getByText('Здесь в лекции больше всего общих слов с карточкой.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Ближайшие фрагменты лекции/ })).toHaveAttribute('aria-expanded', 'true');
  });

  it('gives switches between the fragments of one card, in the order of their numbers', () => {
    render(<SourceReferences ids={['S02', 'S01']} sources={sources} />);
    const button = screen.getByRole('button', { name: 'Ближайшие фрагменты лекции: 2, 1' });
    fireEvent.click(button);
    const panel = screen.getByRole('dialog', { name: 'Фрагмент 1 лекции' });
    const switches = within(panel).getAllByRole('button', { name: /^Фрагмент \d$/ });
    expect(switches.map((item) => item.textContent)).toEqual(['Фрагмент 1', 'Фрагмент 2']);
    fireEvent.click(switches[1]);
    expect(screen.getByRole('dialog', { name: 'Фрагмент 2 лекции' })).toBeInTheDocument();
    fireEvent.keyDown(panel, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(button).toHaveFocus();
  });
});

describe('SourceReferences: a lecture heading on its own line (jury memo 12)', () => {
  it('shows the heading line above the body', () => {
    const panel = open(['S01']);
    const heading = within(panel).getByText('Обучение нейронной сети');
    expect(heading).toHaveAttribute('data-fragment-heading');
    const slip = heading.closest('blockquote') as HTMLElement;
    expect(slip.textContent).toBe('Обучение нейронной сетиОбучение сети заключается в подборе весов и смещений по данным.');
    expect(heading.nextSibling?.textContent).toBe('Обучение сети заключается в подборе весов и смещений по данным.');
  });

  it('leaves a fragment without a heading unchanged (a PDF wrap is not a heading)', () => {
    const panel = open(['S02']);
    const slip = panel.querySelector('.fp-slip') as HTMLElement;
    expect(slip.querySelector('[data-fragment-heading]')).toBeNull();
    // The wrap of the PDF line is joined: one paragraph, no heading.
    expect(slip.textContent).toBe(sources[1].text.replace('\n', ' '));
  });

  it('still says when a fragment text is missing', () => {
    open(['S09']);
    expect(screen.getByText('Текст фрагмента недоступен.')).toBeInTheDocument();
  });

  it('draws the formulas of a page from the web instead of showing LaTeX (QA 2026-10-11)', () => {
    render(
      <SourceReferences
        ids={['S03']}
        sources={[{ id: 'S03', text: 'Теорема Пифагора\nСумма квадратов катетов: $a^{2}+b^{2}=c^{2}$, при этом $\\triangle ABC$ прямоугольный.' }]}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Ближайшие фрагменты лекции/ }));
    const slip = screen.getByRole('dialog').querySelector('.fp-slip') as HTMLElement;
    expect(slip.querySelectorAll('.katex')).toHaveLength(2);
    expect(screen.getByText('Теорема Пифагора')).toHaveAttribute('data-fragment-heading');
    const plain = Array.from(slip.childNodes)
      .filter(node => node.nodeType === Node.TEXT_NODE)
      .map(node => node.textContent)
      .join('');
    // The comma after the short formula stays on its line, with the formula.
    expect(plain).toBe('Сумма квадратов катетов:  при этом  прямоугольный.');
    expect(slip.querySelector('.sv-math-run')?.textContent?.endsWith(',')).toBe(true);
  });
});
