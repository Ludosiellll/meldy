import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import PaperSelect, { type PaperSelectOption } from './PaperSelect';

const KINDS: PaperSelectOption<string>[] = [
  { value: 'exam', label: 'экзамен' },
  { value: 'credit', label: 'зачёт' },
  { value: 'test', label: 'контрольная', disabled: true },
  { value: 'colloquium', label: 'коллоквиум' },
];

function Controlled({ onChange = () => {}, disabled = false }: { onChange?: (value: string) => void; disabled?: boolean }) {
  const [value, setValue] = useState('exam');
  return (
    <p>
      Сдаю{' '}
      <PaperSelect
        ariaLabel="Тип"
        value={value}
        options={KINDS}
        disabled={disabled}
        onChange={(next) => {
          onChange(next);
          setValue(next);
        }}
      />
    </p>
  );
}

const trigger = () => screen.getByRole('combobox', { name: 'Тип' });

afterEach(cleanup);

describe('PaperSelect', () => {
  it('shows the chosen word and keeps the list closed', () => {
    render(<Controlled />);
    expect(trigger()).toHaveTextContent('экзамен');
    expect(trigger()).toHaveAttribute('data-value', 'exam');
    expect(trigger()).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('opens on click, marks the current option and picks another one', () => {
    const onChange = vi.fn();
    render(<Controlled onChange={onChange} />);
    fireEvent.click(trigger());
    expect(trigger()).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('option', { name: 'экзамен' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('option', { name: 'зачёт' })).toHaveAttribute('aria-selected', 'false');

    fireEvent.click(screen.getByRole('option', { name: 'зачёт' }));
    expect(onChange).toHaveBeenCalledWith('credit');
    expect(trigger()).toHaveTextContent('зачёт');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(trigger()).toHaveFocus();
  });

  it('does not report the same value again', () => {
    const onChange = vi.fn();
    render(<Controlled onChange={onChange} />);
    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole('option', { name: 'экзамен' }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('works from the keyboard and skips a disabled option', () => {
    const onChange = vi.fn();
    render(<Controlled onChange={onChange} />);
    trigger().focus();
    fireEvent.keyDown(trigger(), { key: 'ArrowDown' });
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    const active = () => document.getElementById(trigger().getAttribute('aria-activedescendant') ?? '');
    expect(active()).toHaveTextContent('экзамен');

    fireEvent.keyDown(trigger(), { key: 'ArrowDown' });
    expect(active()).toHaveTextContent('зачёт');
    fireEvent.keyDown(trigger(), { key: 'ArrowDown' });
    expect(active()).toHaveTextContent('коллоквиум');
    fireEvent.keyDown(trigger(), { key: 'ArrowDown' });
    expect(active()).toHaveTextContent('экзамен');
    fireEvent.keyDown(trigger(), { key: 'End' });
    expect(active()).toHaveTextContent('коллоквиум');

    fireEvent.keyDown(trigger(), { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('colloquium');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('ignores a click on a disabled option', () => {
    const onChange = vi.fn();
    render(<Controlled onChange={onChange} />);
    fireEvent.click(trigger());
    const disabled = screen.getByRole('option', { name: 'контрольная' });
    expect(disabled).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(disabled);
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('listbox')).toBeInTheDocument();
  });

  it('jumps to an option by its first letters', () => {
    render(<Controlled />);
    fireEvent.keyDown(trigger(), { key: 'Enter' });
    fireEvent.keyDown(trigger(), { key: 'к' });
    const active = () => document.getElementById(trigger().getAttribute('aria-activedescendant') ?? '');
    // «контрольная» недоступна — первая подходящая доступная «коллоквиум».
    expect(active()).toHaveTextContent('коллоквиум');
  });

  it('closes on Escape without a change and returns focus', () => {
    const onChange = vi.fn();
    render(<Controlled onChange={onChange} />);
    fireEvent.click(trigger());
    fireEvent.keyDown(trigger(), { key: 'ArrowDown' });
    fireEvent.keyDown(trigger(), { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
    expect(trigger()).toHaveFocus();
    expect(trigger()).toHaveTextContent('экзамен');
  });

  it('closes when the pointer goes down outside', () => {
    render(
      <div>
        <Controlled />
        <button type="button">Рядом</button>
      </div>,
    );
    fireEvent.click(trigger());
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Рядом' }));
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('stays closed when disabled', () => {
    render(<Controlled disabled />);
    expect(trigger()).toBeDisabled();
    fireEvent.click(trigger());
    fireEvent.keyDown(trigger(), { key: 'ArrowDown' });
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('can sit inside a sentence: no list elements inside the paragraph', () => {
    render(<Controlled />);
    fireEvent.click(trigger());
    const paragraph = trigger().closest('p');
    expect(paragraph?.querySelector('ul, li, div')).toBeNull();
  });
});
