import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import PasteNotice from './PasteNotice';
import { usePasteGuard } from './usePasteGuard';
import { PASTE_REFUSED } from '../../lib/oral/pasteGuard';

const READY = 'Эластичность показывает, на сколько процентов изменится спрос, если цена изменится на один процент.';

function Answer() {
  const guard = usePasteGuard();
  return (
    <div>
      <textarea aria-label="Ваш ответ" onChange={() => guard.clear()} {...guard.fieldProps} />
      <PasteNotice guard={guard} />
    </div>
  );
}

function stubReducedMotion(reduce: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: reduce && query.includes('prefers-reduced-motion'),
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
}

/** The notice's box on a 1280×720 window: under the field, below the window's edge (QA 2026-10-07). */
function placeNotice(top: number, bottom: number) {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const box = this.classList.contains('or-paste-note') ? { top, bottom } : { top: 0, bottom: 0 };
    return { ...box, left: 0, right: 600, width: 600, height: box.bottom - box.top, x: 0, y: box.top, toJSON: () => box } as DOMRect;
  });
}

function paste(field: HTMLElement, text: string) {
  return fireEvent.paste(field, { clipboardData: { getData: () => text } });
}

const innerHeight = window.innerHeight;

beforeEach(() => {
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 720 });
  stubReducedMotion(false);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: innerHeight });
});

describe('<PasteNotice> after a refused paste', () => {
  it('comes into view with the least smooth scroll and leaves the focus in the field', () => {
    placeNotice(741, 785);
    const scroll = vi.spyOn(HTMLElement.prototype, 'scrollIntoView');
    render(<Answer />);
    const field = screen.getByRole('textbox', { name: 'Ваш ответ' });
    field.focus();
    expect(paste(field, READY)).toBe(false);
    const notice = screen.getByRole('status');
    expect(notice).toHaveTextContent(PASTE_REFUSED);
    expect(field).toHaveAttribute('aria-describedby', notice.id);
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(scroll.mock.contexts[0]).toBe(notice);
    expect(scroll).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
    expect(document.activeElement).toBe(field);
  });

  it('jumps without animation under reduced motion', () => {
    stubReducedMotion(true);
    placeNotice(741, 785);
    const scroll = vi.spyOn(HTMLElement.prototype, 'scrollIntoView');
    render(<Answer />);
    paste(screen.getByRole('textbox', { name: 'Ваш ответ' }), READY);
    expect(scroll).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
  });

  it('does not scroll when the line is already in view', () => {
    placeNotice(600, 644);
    const scroll = vi.spyOn(HTMLElement.prototype, 'scrollIntoView');
    render(<Answer />);
    paste(screen.getByRole('textbox', { name: 'Ваш ответ' }), READY);
    expect(screen.getByRole('status')).toHaveTextContent(PASTE_REFUSED);
    expect(scroll).not.toHaveBeenCalled();
  });

  it('comes back into view on every refused paste, and not for a short one or after typing', () => {
    placeNotice(741, 785);
    const scroll = vi.spyOn(HTMLElement.prototype, 'scrollIntoView');
    render(<Answer />);
    const field = screen.getByRole('textbox', { name: 'Ваш ответ' });
    paste(field, READY);
    paste(field, READY); // the student scrolled away and tried again: the line is already there
    expect(scroll).toHaveBeenCalledTimes(2);
    expect(paste(field, 'функция потерь')).toBe(true); // a term goes in
    expect(scroll).toHaveBeenCalledTimes(2);
    fireEvent.change(field, { target: { value: 'Обучение — это' } });
    expect(screen.queryByRole('status')).toBeNull();
    expect(field).not.toHaveAttribute('aria-describedby');
    expect(scroll).toHaveBeenCalledTimes(2);
  });
});
