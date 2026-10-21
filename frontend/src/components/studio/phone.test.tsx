import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { frameSizeOf } from '../exams/useFrame';
import { STUDIO } from './copyStudio';
import { bottomBarShown, hasBottomBar, revealBlock, sendWords, takesKeyboard, tourClipFits } from './phone';
import Tour from './Tour';

/* The studio on a phone and a tablet (phone audit of 19.10). */

function stubWindow(width: number, height: number) {
  vi.stubGlobal('innerWidth', width);
  vi.stubGlobal('innerHeight', height);
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({ matches: false, media: query, onchange: null, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn() })),
  );
}

beforeEach(() => window.localStorage.clear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the bottom bar', () => {
  it('stands on every width without the three columns: 600 to 1023 px in 40 px steps, and not from 1024', () => {
    for (let width = 600; width < 1024; width += 40) expect([width, hasBottomBar(frameSizeOf(width))]).toEqual([width, true]);
    for (const width of [639, 640, 1023, 360, 320]) expect([width, hasBottomBar(frameSizeOf(width))]).toEqual([width, true]);
    for (const width of [1024, 1100, 1280, 1532]) expect([width, hasBottomBar(frameSizeOf(width))]).toEqual([width, false]);
  });

  it('steps away while a field of the page takes the keyboard, and comes back after', () => {
    expect(bottomBarShown('s', false)).toBe(true);
    expect(bottomBarShown('s', true)).toBe(false);
    expect(bottomBarShown('m', false)).toBe(true);
    expect(bottomBarShown('m', true)).toBe(false);
    expect(bottomBarShown('l', false)).toBe(false);
  });

  it('a field that opens the keyboard: text, textarea, editable; not a button, a tick or a read-only field', () => {
    const make = (html: string) => {
      const box = document.createElement('div');
      box.innerHTML = html;
      document.body.append(box);
      return box.firstElementChild as HTMLElement;
    };
    expect(takesKeyboard(make('<textarea></textarea>'))).toBe(true);
    expect(takesKeyboard(make('<input>'))).toBe(true);
    expect(takesKeyboard(make('<input type="url">'))).toBe(true);
    expect(takesKeyboard(make('<input type="checkbox">'))).toBe(false);
    expect(takesKeyboard(make('<input type="range">'))).toBe(false);
    expect(takesKeyboard(make('<textarea readonly></textarea>'))).toBe(false);
    expect(takesKeyboard(make('<button>Блоки</button>'))).toBe(false);
    expect(takesKeyboard(make('<div tabindex="0">Блок</div>'))).toBe(false);
    expect(takesKeyboard(null)).toBe(false);
  });

  it('says «Отправить» below 400 px (19.10: «Отправить по ссылке» did not fit at 375 and 360)', () => {
    expect(sendWords(360)).toBe(STUDIO.sendShort);
    expect(sendWords(375)).toBe(STUDIO.sendShort);
    expect(sendWords(399)).toBe(STUDIO.sendShort);
    expect(sendWords(400)).toBe(STUDIO.send);
    expect(sendWords(820)).toBe(STUDIO.send);
    // Not measured yet: the whole words.
    expect(sendWords(0)).toBe(STUDIO.send);
  });
});

describe('a block just added', () => {
  it('is brought to the middle of the screen, not just «nearest» (which left it under the bar)', () => {
    stubWindow(375, 667);
    const root = document.createElement('div');
    root.innerHTML = '<div data-block="a"></div><div data-block="b"></div>';
    document.body.append(root);
    const into = vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(() => undefined);
    expect(revealBlock(root, 'b')).toBe(true);
    expect(into.mock.contexts).toEqual([root.querySelector('[data-block="b"]')]);
    expect(into.mock.calls[0][0]).toMatchObject({ block: 'center' });
    expect(revealBlock(root, 'gone')).toBe(false);
    expect(revealBlock(null, 'b')).toBe(false);
    expect(into).toHaveBeenCalledTimes(1);
  });
});

describe('the tour on a phone', () => {
  const card = () => screen.getByRole('dialog', { name: STUDIO.tourLabel });

  it('the clip only where it fits: from 480 px wide and 600 px high', () => {
    expect(tourClipFits(375, 667)).toBe(false);
    expect(tourClipFits(479, 900)).toBe(false);
    expect(tourClipFits(844, 390)).toBe(false);
    expect(tourClipFits(820, 1180)).toBe(true);
    expect(tourClipFits(1440, 900)).toBe(true);
  });

  it('a phone: no clip, the phone’s words («Нажмите «Блоки» → «Заголовок»»), one counter', () => {
    stubWindow(375, 667);
    render(<Tour userId="user-1" phone onDone={() => undefined} />);
    expect(card().querySelector('.st-tour-clip')).toBeNull();
    expect(card()).toHaveTextContent('Нажмите «Блоки» внизу, затем «Заголовок»');
    expect(card()).not.toHaveTextContent(/Перетащите/);
    expect(within(card()).getAllByText(/\d\s*(из|\/)\s*\d/)).toHaveLength(1);
    expect(within(card()).getByText(STUDIO.tourStep(1, 4))).toBeInTheDocument();
    fireEvent.click(within(card()).getByRole('button', { name: STUDIO.tourNext }));
    // The second step names the phone's settings, not «Справа».
    expect(card()).toHaveTextContent(STUDIO.tourPhoneEdit.text);
    expect(card()).not.toHaveTextContent(/Справа/);
  });

  it('a phone on its side (844 × 390): no clip either; the card scrolls inside itself', () => {
    stubWindow(844, 390);
    render(<Tour userId="user-1" phone onDone={() => undefined} />);
    expect(card().querySelector('.st-tour-clip')).toBeNull();
    expect(card().querySelector('.st-tour-in')).not.toBeNull();
  });

  it('a computer keeps the clip', () => {
    stubWindow(1440, 900);
    render(<Tour userId="user-1" onDone={() => undefined} />);
    expect(card().querySelector('.st-tour-clip')).not.toBeNull();
    expect(card()).toHaveTextContent(STUDIO.tour[0].text);
  });
});
