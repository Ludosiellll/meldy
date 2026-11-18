import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import DateField, { DATE_COPY, ownsCalendar, placeCalendar } from './DateField';

/** A computer with a Chromium browser and a mouse (the field draws its own calendar), or not. */
function device(chromium: boolean, mouse = true) {
  Object.defineProperty(window.navigator, 'userAgentData', { configurable: true, value: chromium ? { brands: [] } : undefined });
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: mouse && /pointer: fine/.test(query), media: query, addEventListener() {}, removeEventListener() {} }));
}

function Field({ start = '', min, max, onChange }: { start?: string; min?: string; max?: string; onChange?: (value: string) => void }) {
  const [value, setValue] = useState(start);
  return (
    <label>
      Дата экзамена
      <DateField
        className="im-input im-date"
        value={value}
        min={min}
        max={max}
        onChange={(event) => {
          setValue(event.target.value);
          onChange?.(event.target.value);
        }}
      />
    </label>
  );
}

const field = () => screen.getByLabelText('Дата экзамена') as HTMLInputElement;
const calendar = () => screen.queryByRole('dialog', { name: DATE_COPY.calendar });
const day = (name: RegExp | string) => within(calendar() as HTMLElement).getByRole('button', { name });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 10, 18, 12, 0));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  Object.defineProperty(window.navigator, 'userAgentData', { configurable: true, value: undefined });
});

describe('DateField: the site’s own calendar on a date field', () => {
  it('draws its own calendar only in Chromium with a mouse; elsewhere the field is the browser’s, untouched', () => {
    device(false);
    expect(ownsCalendar()).toBe(false);
    device(true, false);
    expect(ownsCalendar()).toBe(false);
    render(<Field start="2026-11-27" />);
    expect([field().type, field().value, field().getAttribute('data-df'), field().getAttribute('aria-haspopup')]).toEqual(['date', '2026-11-27', null, null]);
    fireEvent.click(field());
    fireEvent.keyDown(field(), { key: 'ArrowDown', altKey: true });
    expect(calendar()).toBeNull();
    // typing a date still reaches the page
    fireEvent.change(field(), { target: { value: '2026-12-01' } });
    expect(field().value).toBe('2026-12-01');
    cleanup();
    device(true);
    expect(ownsCalendar()).toBe(true);
  });

  it('a press on the mark opens the chosen day’s month; a press on a day sets the field and closes the calendar', () => {
    device(true);
    const onChange = vi.fn();
    render(<Field start="2026-11-27" min="2026-11-18" max="2027-11-18" onChange={onChange} />);
    expect([field().getAttribute('data-df'), field().getAttribute('aria-expanded')]).toEqual(['own', 'false']);
    fireEvent.click(field());
    const pop = calendar() as HTMLElement;
    expect(within(pop).getByText('Ноябрь 2026')).toBeTruthy();
    expect(field().getAttribute('aria-expanded')).toBe('true');
    expect(day('27 ноября, пятница').getAttribute('aria-pressed')).toBe('true');
    expect(day('18 ноября, среда').getAttribute('aria-current')).toBe('date');
    // the focus stands on the chosen day; the line under the grid says how far it is
    expect(document.activeElement).toBe(day('27 ноября, пятница'));
    expect(within(pop).getByText('через 9 дней')).toBeTruthy();
    // days before the field's min cannot be pressed
    expect((day('17 ноября, вторник') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(day('30 ноября, понедельник'));
    expect(onChange).toHaveBeenCalledWith('2026-11-30');
    expect(field().value).toBe('2026-11-30');
    expect(calendar()).toBeNull();
    expect(document.activeElement).toBe(field());
  });

  it('an empty field opens on today; the months turn within min and max; Alt+↓ opens, Escape and a press outside close', () => {
    device(true);
    render(<Field min="2026-11-18" max="2026-12-20" />);
    fireEvent.keyDown(field(), { key: 'ArrowDown', altKey: true });
    const pop = calendar() as HTMLElement;
    expect(within(pop).getByText('Ноябрь 2026')).toBeTruthy();
    expect(document.activeElement).toBe(day('18 ноября, среда'));
    expect((within(pop).getByRole('button', { name: DATE_COPY.prev }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(pop).getByRole('button', { name: DATE_COPY.next }));
    expect(within(pop).getByText('Декабрь 2026')).toBeTruthy();
    expect((within(pop).getByRole('button', { name: DATE_COPY.next }) as HTMLButtonElement).disabled).toBe(true);
    expect((day('21 декабря, понедельник') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(pop, { key: 'Escape' });
    expect(calendar()).toBeNull();
    expect(document.activeElement).toBe(field());
    fireEvent.keyDown(field(), { key: 'F4' });
    expect(calendar()).not.toBeNull();
    fireEvent.pointerDown(document.body);
    expect(calendar()).toBeNull();
  });

  it('the arrows walk the days, over a month’s end too, and never past min and max; Enter is a press', () => {
    device(true);
    const onChange = vi.fn();
    render(<Field start="2026-11-27" min="2026-11-18" max="2026-12-20" onChange={onChange} />);
    fireEvent.click(field());
    const key = (name: string) => fireEvent.keyDown(document.activeElement as HTMLElement, { key: name });
    key('ArrowRight');
    expect(document.activeElement).toBe(day('28 ноября, суббота'));
    key('ArrowDown');
    expect(within(calendar() as HTMLElement).getByText('Декабрь 2026')).toBeTruthy();
    expect(document.activeElement).toBe(day('5 декабря, суббота'));
    key('End');
    expect(document.activeElement).toBe(day('20 декабря, воскресенье')); // the month's last day is past max
    key('PageUp');
    expect(document.activeElement).toBe(day('20 ноября, пятница'));
    key('ArrowUp');
    expect(document.activeElement).toBe(day('18 ноября, среда')); // 13 ноября is before min
    key('Home');
    expect(document.activeElement).toBe(day('18 ноября, среда'));
    fireEvent.click(document.activeElement as HTMLElement);
    expect(onChange).toHaveBeenCalledWith('2026-11-18');
  });

  it('«Через: неделю · 2 недели · месяц» set a day counted from today; one past max cannot be pressed', () => {
    device(true);
    const onChange = vi.fn();
    render(<Field min="2026-11-18" max="2026-12-05" onChange={onChange} />);
    fireEvent.click(field());
    const pick = (label: string) => within(calendar() as HTMLElement).getByRole('button', { name: new RegExp(`^${DATE_COPY.picksLabel} ${label}`) }) as HTMLButtonElement;
    expect([pick('неделю').disabled, pick('2 недели').disabled, pick('месяц').disabled]).toEqual([false, false, true]);
    fireEvent.click(pick('2 недели'));
    expect(onChange).toHaveBeenCalledWith('2026-12-02');
    expect(calendar()).toBeNull();
  });

  it('a field that is switched off does not open; the calendar of a field in a dialog stands inside the dialog', () => {
    device(true);
    render(
      <div role="dialog" aria-modal="true" aria-label="Перенести экзамен">
        <DateField aria-label="Новая дата" value="2026-11-27" onChange={() => {}} />
        <DateField aria-label="Выключено" value="2026-11-27" disabled onChange={() => {}} />
      </div>,
    );
    fireEvent.click(screen.getByLabelText('Выключено'));
    expect(calendar()).toBeNull();
    fireEvent.click(screen.getByLabelText('Новая дата'));
    expect(screen.getByRole('dialog', { name: 'Перенести экзамен' }).contains(calendar())).toBe(true);
  });

  it('stands under its field, over it when there is no room below, and never past the window’s edges', () => {
    const size = { width: 308, height: 420 };
    expect(placeCalendar({ top: 100, bottom: 152, left: 40 }, size, { width: 1532, height: 734 })).toEqual({ top: 160, left: 40, above: false });
    expect(placeCalendar({ top: 560, bottom: 612, left: 40 }, size, { width: 1532, height: 734 })).toEqual({ top: 132, left: 40, above: true });
    expect(placeCalendar({ top: 300, bottom: 352, left: 1400 }, size, { width: 1532, height: 734 }).left).toBe(1216);
    // no room on either side: it stays in the window
    expect(placeCalendar({ top: 200, bottom: 252, left: 8 }, size, { width: 400, height: 460 }).top).toBe(32);
  });
});
