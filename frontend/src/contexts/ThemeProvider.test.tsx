import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { THEME_CANVAS, ThemeProvider, useTheme } from './ThemeProvider';

const KEY = 'studyforge-theme';
let osDark = false;
/** The device's «change» listeners, as a browser keeps them (old Safari's addListener included). */
let listeners: Array<() => void> = [];

function stubMatchMedia({ oldSafari = false } = {}) {
  listeners = [];
  const add = (_type: string | (() => void), cb?: () => void) => listeners.push((cb ?? _type) as () => void);
  const remove = (_type: string | (() => void), cb?: () => void) => {
    listeners = listeners.filter((listener) => listener !== (cb ?? _type));
  };
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      get matches() {
        return query.includes('dark') ? osDark : false;
      },
      media: query,
      onchange: null,
      ...(oldSafari ? {} : { addEventListener: add, removeEventListener: remove }),
      addListener: (cb: () => void) => add(cb),
      removeListener: (cb: () => void) => remove(cb),
      dispatchEvent: () => false,
    }),
  });
}

/** The device switches its theme while the page is open. */
function deviceSwitches(dark: boolean) {
  osDark = dark;
  act(() => {
    for (const listener of [...listeners]) listener();
  });
}

function addThemeColorMetas() {
  document.head.querySelectorAll('meta[name="theme-color"]').forEach(meta => meta.remove());
  for (const [media, color] of [
    ['(prefers-color-scheme: light)', '#f3f3f0'],
    ['(prefers-color-scheme: dark)', '#0b0f16'],
  ]) {
    const meta = document.createElement('meta');
    meta.name = 'theme-color';
    meta.media = media;
    meta.content = color;
    document.head.appendChild(meta);
  }
}

const metaColors = () => Array.from(document.querySelectorAll('meta[name="theme-color"]')).map(meta => meta.getAttribute('content'));

let setThemeRef: ((theme: 'dark' | 'light' | 'system') => void) | null = null;
function Probe() {
  const { theme, resolved, setTheme } = useTheme();
  setThemeRef = setTheme;
  return (
    <>
      <p>Тема: {theme}</p>
      <p>На экране: {resolved}</p>
    </>
  );
}

function renderProvider() {
  return render(
    <ThemeProvider defaultTheme="system" storageKey={KEY}>
      <Probe />
    </ThemeProvider>,
  );
}

beforeEach(() => {
  osDark = false;
  stubMatchMedia();
  addThemeColorMetas();
  document.documentElement.className = '';
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  setThemeRef = null;
});

describe('ThemeProvider', () => {
  it('applies a stored dark theme and paints the browser bar with the dark canvas', () => {
    window.localStorage.setItem(KEY, 'dark');
    renderProvider();
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(document.documentElement.classList.contains('light')).toBe(false);
    expect(metaColors()).toEqual([THEME_CANVAS.dark, THEME_CANVAS.dark]);
    expect(THEME_CANVAS).toEqual({ light: '#f3f3f0', dark: '#0b0f16' });
  });

  it('keeps an explicit light choice on a dark OS', () => {
    osDark = true;
    window.localStorage.setItem(KEY, 'light');
    renderProvider();
    expect(document.documentElement.classList.contains('light')).toBe(true);
    expect(metaColors()).toEqual(['#f3f3f0', '#f3f3f0']);
  });

  it('follows the OS without a stored choice', () => {
    osDark = true;
    renderProvider();
    expect(screen.getByText('Тема: system')).toBeInTheDocument();
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(metaColors()).toEqual(['#0b0f16', '#0b0f16']);
  });

  it('updates class, metas and the same storage key on setTheme', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    renderProvider();
    expect(metaColors()).toEqual(['#f3f3f0', '#f3f3f0']);
    act(() => setThemeRef!('dark'));
    expect(setItem).toHaveBeenCalledWith(KEY, 'dark');
    expect(window.localStorage.getItem(KEY)).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(metaColors()).toEqual(['#0b0f16', '#0b0f16']);
    act(() => setThemeRef!('light'));
    expect(document.documentElement.className).toBe('light');
    expect(metaColors()).toEqual(['#f3f3f0', '#f3f3f0']);
  });

  it('survives blocked storage', () => {
    osDark = true;
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    renderProvider();
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    act(() => setThemeRef!('light'));
    expect(document.documentElement.classList.contains('light')).toBe(true);
  });

  it('ignores an unknown stored value', () => {
    window.localStorage.setItem(KEY, 'sepia');
    renderProvider();
    expect(screen.getByText('Тема: system')).toBeInTheDocument();
    expect(document.documentElement.classList.contains('light')).toBe(true);
  });

  it('names the theme on the screen: the chosen one, or the device\'s while nothing is chosen', () => {
    osDark = true;
    renderProvider();
    expect(screen.getByText('На экране: dark')).toBeInTheDocument();
    act(() => setThemeRef!('light'));
    expect(screen.getByText('На экране: light')).toBeInTheDocument();
    expect(screen.getByText('Тема: light')).toBeInTheDocument();
  });

  it('follows the device while nothing is chosen, also when it switches with the page open', () => {
    renderProvider();
    expect(document.documentElement.className).toBe('light');
    deviceSwitches(true);
    expect(document.documentElement.className).toBe('dark');
    expect(metaColors()).toEqual(['#0b0f16', '#0b0f16']);
    expect(screen.getByText('На экране: dark')).toBeInTheDocument();
    deviceSwitches(false);
    expect(document.documentElement.className).toBe('light');
    expect(screen.getByText('На экране: light')).toBeInTheDocument();
  });

  it('stops following the device once a theme is chosen, and lets go of it when it leaves', () => {
    const { unmount } = renderProvider();
    expect(listeners).toHaveLength(1);
    act(() => setThemeRef!('dark'));
    expect(listeners).toHaveLength(0);
    deviceSwitches(false);
    expect(document.documentElement.className).toBe('dark');
    act(() => setThemeRef!('system'));
    expect(listeners).toHaveLength(1);
    expect(document.documentElement.className).toBe('light');
    unmount();
    expect(listeners).toHaveLength(0);
  });

  it('follows the device on an old Safari too (addListener)', () => {
    stubMatchMedia({ oldSafari: true });
    const { unmount } = renderProvider();
    expect(listeners).toHaveLength(1);
    deviceSwitches(true);
    expect(document.documentElement.className).toBe('dark');
    unmount();
    expect(listeners).toHaveLength(0);
  });
});
