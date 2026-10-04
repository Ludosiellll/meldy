import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import SourceReferences from './SourceReferences';

afterEach(cleanup);

const sources = [
  { id: 'S01', text: 'Обучение нейронной сети\nОбучение сети заключается в подборе весов и смещений по данным.' },
  { id: 'S02', text: 'Рост ВВП в номинальном выражении по итогам года составил\n7 % при инфляции около пяти процентов, что выше прогноза.' },
];

function open(ids: string[]) {
  render(<SourceReferences ids={ids} sources={sources} />);
  fireEvent.click(screen.getByRole('button', { name: /Ближайшие фрагменты лекции/ }));
}

describe('SourceReferences: a lecture heading on its own line (jury memo 12)', () => {
  it('shows the heading line above the body and keeps «Фрагмент N.»', () => {
    open(['S01']);
    const heading = screen.getByText('Обучение нейронной сети');
    expect(heading).toHaveAttribute('data-fragment-heading');
    const fragment = heading.closest('p') as HTMLElement;
    expect(fragment).toHaveTextContent(/^Фрагмент 1\.Обучение нейронной сетиОбучение сети заключается в подборе весов и смещений по данным\.$/);
    const body = screen.getByText('Обучение сети заключается в подборе весов и смещений по данным.');
    // The body is a block of its own: it starts a new line under the heading.
    expect(body).toHaveClass('block');
    expect(body.previousElementSibling).toBe(heading);
  });

  it('leaves a fragment without a heading unchanged (a PDF wrap is not a heading)', () => {
    open(['S02']);
    const fragment = screen.getByText(/Фрагмент 2\./).closest('p') as HTMLElement;
    expect(fragment.querySelector('[data-fragment-heading]')).toBeNull();
    expect(fragment.textContent).toBe(`Фрагмент 2.${sources[1].text}`);
  });

  it('still says when a fragment text is missing', () => {
    open(['S09']);
    expect(screen.getByText('Текст фрагмента недоступен.')).toBeInTheDocument();
  });
});
