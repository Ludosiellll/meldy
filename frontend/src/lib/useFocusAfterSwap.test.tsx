import { cleanup, render } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { useFocusAfterSwap } from './useFocusAfterSwap';

/* Accessibility audit 07.11, A11Y-4: a swapped screen takes the focus that went with the old one, and only that. */
afterEach(() => cleanup());

function Screen({ step, autofocus = false }: { step: string; autofocus?: boolean }) {
  const ref = useRef<HTMLElement | null>(null);
  useFocusAfterSwap(ref, step);
  return (
    <main ref={ref}>
      <h1>{step}</h1>
      {autofocus ? <input aria-label="PIN" data-autofocus="" /> : <button type="button">Дальше</button>}
    </main>
  );
}

describe('useFocusAfterSwap', () => {
  it('a new screen\\u2019s heading takes a lost focus; an autofocus field comes first', () => {
    const view = render(<Screen step="pin" autofocus />);
    expect(document.activeElement).toBe(view.getByLabelText('PIN'));
    (document.activeElement as HTMLElement).blur();
    view.rerender(<Screen step="question" />);
    expect(document.activeElement).toBe(view.getByRole('heading', { name: 'question' }));
    expect(view.getByRole('heading', { name: 'question' })).toHaveAttribute('tabindex', '-1');
  });

  it('never takes a focus the person holds', () => {
    const view = render(
      <>
        <button type="button">Где-то ещё</button>
        <Screen step="lobby" />
      </>,
    );
    const elsewhere = view.getByRole('button', { name: 'Где-то ещё' });
    elsewhere.focus();
    view.rerender(
      <>
        <button type="button">Где-то ещё</button>
        <Screen step="question" />
      </>,
    );
    expect(document.activeElement).toBe(elsewhere);
  });
});
