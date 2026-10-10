import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import PaperSelect, { LIST_EDGE, placeList, scrollToShow, type PaperSelectOption } from './PaperSelect';
import { Sheet } from '../containers/ui';

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

// ── The list in a portal, fixed to the window (usability check of 2026-10-10, M2) ─────────────────────────────

describe('PaperSelect: where the open list stands', () => {
  const phone = { width: 390, height: 844 };
  const desk = { width: 1532, height: 734 };
  const pill = (top: number, left = 16, width = 96, height = 44) => ({ top, bottom: top + height, left, width });

  it('goes under its pill when the list fits there', () => {
    expect(placeList(pill(250, 700), { height: 300, width: 200 }, desk)).toEqual({ top: 302, left: 700, maxHeight: 300, above: false });
  });

  it('goes over its pill when there is more room above (a pill at the bottom of a phone sheet)', () => {
    const spot = placeList(pill(640), { height: 540, width: 160 }, phone);
    expect(spot.above).toBe(true);
    // Never taller than 320 px; it ends 8 px over the pill and starts inside the window.
    expect(spot.maxHeight).toBe(320);
    expect(spot.top + spot.maxHeight).toBe(640 - 8);
    expect(spot.top).toBeGreaterThanOrEqual(LIST_EDGE);
  });

  it('a pill low in a short dialog: over it, inside the window, the list scrolling inside itself', () => {
    const spot = placeList(pill(600, 772), { height: 540, width: 200 }, desk);
    expect(spot).toMatchObject({ above: true });
    expect(spot.top).toBeGreaterThanOrEqual(LIST_EDGE);
    expect(spot.top + spot.maxHeight).toBeLessThanOrEqual(desk.height - LIST_EDGE);
  });

  it('no room on either side (a phone on its side): the window’s height, over the pill, inside the window', () => {
    const spot = placeList(pill(150), { height: 540, width: 200 }, { width: 844, height: 360 });
    expect(spot.above).toBe(false);
    expect(spot.top).toBeGreaterThanOrEqual(LIST_EDGE);
    expect(spot.top + spot.maxHeight).toBeLessThanOrEqual(360 - LIST_EDGE);
    expect(spot.maxHeight).toBeGreaterThan(132);
  });

  it('never leaves the window sideways: a pill at the right edge moves its list left', () => {
    const spot = placeList(pill(100, 340, 44), { height: 200, width: 220 }, phone);
    expect(spot.left).toBe(390 - LIST_EDGE - 220);
    expect(placeList(pill(100, 2, 44), { height: 200, width: 220 }, phone).left).toBe(LIST_EDGE);
  });

  it('scrolls the list, not the page, to show an option', () => {
    expect(scrollToShow({ scrollTop: 0, clientHeight: 320 }, { offsetTop: 490, offsetHeight: 44 })).toBe(214);
    expect(scrollToShow({ scrollTop: 214, clientHeight: 320 }, { offsetTop: 6, offsetHeight: 44 })).toBe(6);
    expect(scrollToShow({ scrollTop: 100, clientHeight: 320 }, { offsetTop: 200, offsetHeight: 44 })).toBe(100);
  });
});

const MINUTES: PaperSelectOption<number>[] = [10, 15, 20, 30, 40, 45, 60, 80, 90, 120].map((m) => ({ value: m, label: String(m) })).concat([{ value: 0, label: 'без времени' }]);

/** A fake layout for jsdom: a window of 390 × 844, the pill near its bottom, options of 44 px after 6 px of padding. */
function fakeLayout(pillTop: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 844 });
  const isList = (el: HTMLElement) => el.getAttribute('role') === 'listbox';
  const isOption = (el: HTMLElement) => el.getAttribute('role') === 'option';
  const index = (el: HTMLElement) => Number(el.getAttribute('data-index'));
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return isList(this) ? this.querySelectorAll('[role="option"]').length * 44 + 12 : 0;
  });
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) {
    return isList(this) ? 180 : 96;
  });
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return isList(this) ? parseFloat(this.style.maxHeight) || 0 : 0;
  });
  vi.spyOn(HTMLElement.prototype, 'offsetTop', 'get').mockImplementation(function (this: HTMLElement) {
    return isOption(this) ? 6 + index(this) * 44 : 0;
  });
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return isOption(this) ? 44 : 0;
  });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (isList(this)) {
      const top = parseFloat(this.style.top) || 0;
      const left = parseFloat(this.style.left) || 0;
      const height = parseFloat(this.style.maxHeight) || 0;
      return { top, left, bottom: top + height, right: left + 180, width: 180, height, x: left, y: top, toJSON: () => ({}) } as DOMRect;
    }
    if (this.getAttribute('role') === 'combobox') return { top: pillTop, left: 16, bottom: pillTop + 44, right: 112, width: 96, height: 44, x: 16, y: pillTop, toJSON: () => ({}) } as DOMRect;
    return { top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
  });
}

function MinutesSheet({ onChange = () => {}, onClose = () => {} }: { onChange?: (value: number) => void; onClose?: () => void }) {
  const [value, setValue] = useState(40);
  return (
    <Sheet title="Как на экзамене" onClose={onClose}>
      <p>Минут</p>
      <PaperSelect
        ariaLabel="Минут"
        value={value}
        options={MINUTES}
        onChange={(next) => {
          onChange(next);
          setValue(next);
        }}
      />
    </Sheet>
  );
}

describe('PaperSelect in a sheet', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 768 });
  });

  it('puts its list in the dialog (a screen reader still reads it there), fixed to the window, not inside the pill', () => {
    render(<MinutesSheet />);
    const combo = screen.getByRole('combobox', { name: 'Минут' });
    fireEvent.click(combo);
    const list = screen.getByRole('listbox', { name: 'Минут' });
    const dialog = screen.getByRole('dialog', { name: 'Как на экзамене' });
    expect(dialog.contains(list)).toBe(true);
    expect(combo.parentElement?.contains(list)).toBe(false);
    expect(list).toHaveAttribute('data-float');
    expect(list).toHaveAttribute('data-placed');
    expect(combo).toHaveAttribute('aria-controls', list.id);
  });

  it('a tall list low on a phone: the last option is inside the window and can be hit, by keys and by a tap', () => {
    fakeLayout(640);
    const onChange = vi.fn();
    render(<MinutesSheet onChange={onChange} />);
    const combo = screen.getByRole('combobox', { name: 'Минут' });
    fireEvent.click(combo);
    const list = screen.getByRole('listbox', { name: 'Минут' });
    const top = parseFloat(list.style.top);
    const height = parseFloat(list.style.maxHeight);
    // The list stands over the pill, whole inside the window.
    expect(list).toHaveAttribute('data-above');
    expect(top).toBeGreaterThanOrEqual(LIST_EDGE);
    expect(top + height).toBeLessThanOrEqual(640 - 8);

    fireEvent.keyDown(combo, { key: 'End' });
    const options = screen.getAllByRole('option');
    const last = options[options.length - 1];
    expect(document.getElementById(combo.getAttribute('aria-activedescendant') ?? '')).toBe(last);
    // Hit-test: the last option's box, after the list scrolled itself, lies inside the list and inside the window.
    const lastTop = top + last.offsetTop - list.scrollTop;
    expect(lastTop).toBeGreaterThanOrEqual(top);
    expect(lastTop + last.offsetHeight).toBeLessThanOrEqual(top + height);
    expect(lastTop + last.offsetHeight).toBeLessThanOrEqual(844);
    fireEvent.pointerDown(last);
    fireEvent.click(last);
    expect(onChange).toHaveBeenCalledWith(0);
    expect(combo).toHaveTextContent('без времени');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(combo).toHaveFocus();
  });

  it('Escape closes the list and leaves the sheet open; the next Escape closes the sheet', () => {
    const onClose = vi.fn();
    render(<MinutesSheet onClose={onClose} />);
    const combo = screen.getByRole('combobox', { name: 'Минут' });
    combo.focus();
    fireEvent.keyDown(combo, { key: 'ArrowDown' });
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    fireEvent.keyDown(combo, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    expect(combo).toHaveFocus();
    fireEvent.keyDown(combo, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('a tap inside the list does not close it; a tap elsewhere in the sheet does', () => {
    render(<MinutesSheet />);
    fireEvent.click(screen.getByRole('combobox', { name: 'Минут' }));
    fireEvent.pointerDown(screen.getByRole('listbox'));
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    fireEvent.pointerDown(screen.getByText('Минут', { selector: 'p' }));
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('outside any dialog the list goes to the page’s body', () => {
    render(<Controlled />);
    fireEvent.click(trigger());
    expect(screen.getByRole('listbox').parentElement).toBe(document.body);
  });
});
