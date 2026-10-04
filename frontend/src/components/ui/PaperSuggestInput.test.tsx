import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import PaperSuggestInput, { matchSuggestions } from './PaperSuggestInput';

const SUBJECTS = ['Микроэкономика', 'Макроэкономика', 'История', 'Экономика труда', 'Микроэкономика'];

function Field({ initial = '' }: { initial?: string }) {
  const [value, setValue] = useState(initial);
  return (
    <form onSubmit={(event) => event.preventDefault()}>
      <PaperSuggestInput aria-label="Название экзамена" value={value} onValueChange={setValue} suggestions={SUBJECTS} />
    </form>
  );
}

const field = () => screen.getByRole('combobox', { name: 'Название экзамена' });

afterEach(cleanup);

describe('matchSuggestions', () => {
  it('puts the ones that start with the text first and drops repeats and the text itself', () => {
    expect(matchSuggestions(SUBJECTS, 'эконом')).toEqual(['Экономика труда', 'Микроэкономика', 'Макроэкономика']);
    expect(matchSuggestions(SUBJECTS, 'История')).toEqual([]);
    expect(matchSuggestions(SUBJECTS, '', 2)).toEqual(['Микроэкономика', 'Макроэкономика']);
  });
});

describe('PaperSuggestInput', () => {
  it('stays closed on focus and opens while typing', () => {
    render(<Field />);
    fireEvent.focus(field());
    expect(screen.queryByRole('listbox')).toBeNull();
    fireEvent.change(field(), { target: { value: 'макро' } });
    expect(field()).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual(['Макроэкономика']);
  });

  it('fills the field with a clicked suggestion and closes', () => {
    render(<Field />);
    fireEvent.change(field(), { target: { value: 'ист' } });
    fireEvent.click(screen.getByRole('option', { name: 'История' }));
    expect(field()).toHaveValue('История');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('works from the keyboard: arrows, Enter takes the chosen one, Esc closes', () => {
    render(<Field />);
    fireEvent.change(field(), { target: { value: 'эконом' } });
    fireEvent.keyDown(field(), { key: 'ArrowDown' });
    fireEvent.keyDown(field(), { key: 'ArrowDown' });
    expect(document.getElementById(field().getAttribute('aria-activedescendant') ?? '')).toHaveTextContent('Микроэкономика');
    fireEvent.keyDown(field(), { key: 'Enter' });
    expect(field()).toHaveValue('Микроэкономика');
    expect(screen.queryByRole('listbox')).toBeNull();

    // An exact match offers nothing; an empty field offers every subject on a click.
    fireEvent.click(field());
    expect(screen.queryByRole('listbox')).toBeNull();
    fireEvent.change(field(), { target: { value: '' } });
    fireEvent.click(field());
    expect(screen.getAllByRole('option')).toHaveLength(4);
    fireEvent.keyDown(field(), { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('keeps free text: Enter without a chosen suggestion does nothing to the field', () => {
    render(<Field initial="Теория игр" />);
    fireEvent.click(field());
    fireEvent.keyDown(field(), { key: 'Enter' });
    expect(field()).toHaveValue('Теория игр');
  });
});
