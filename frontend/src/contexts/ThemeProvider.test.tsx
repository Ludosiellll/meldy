import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { THEME_CANVAS, ThemeProvider, useTheme } from './ThemeProvider';

const KEY = 'studyforge-theme';
let osDark = false;

function stubMatchMedia() {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: query.includes('dark') ? osDark : false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

function addThemeColorMetas() {
  document.head.querySelectorAll('meta[name="theme-color"]').forEach(meta => meta.remove());
  for (const [media, color] of [
    ['(prefers-color-scheme: light)', '#f6f5f4'],
    ['(prefers-color-scheme: dark)', '#1f1e1c'],
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
  const { theme, setTheme } = useTheme();
  setThemeRef = setTheme;
  return <p>Тема: {theme}</p>;
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
    expect(THEME_CANVAS).toEqual({ light: '#f6f5f4', dark: '#1f1e1c' });
  });

  it('keeps an explicit light choice on a dark OS', () => {
    osDark = true;
    window.localStorage.setItem(KEY, 'light');
    renderProvider();
    expect(document.documentElement.classList.contains('light')).toBe(true);
    expect(metaColors()).toEqual(['#f6f5f4', '#f6f5f4']);
  });

  it('follows the OS without a stored choice', () => {
    osDark = true;
    renderProvider();
    expect(screen.getByText('Тема: system')).toBeInTheDocument();
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(metaColors()).toEqual(['#1f1e1c', '#1f1e1c']);
  });

  it('updates class, metas and the same storage key on setTheme', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    renderProvider();
    expect(metaColors()).toEqual(['#f6f5f4', '#f6f5f4']);
    act(() => setThemeRef!('dark'));
    expect(setItem).toHaveBeenCalledWith(KEY, 'dark');
    expect(window.localStorage.getItem(KEY)).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(metaColors()).toEqual(['#1f1e1c', '#1f1e1c']);
    act(() => setThemeRef!('light'));
    expect(document.documentElement.className).toBe('light');
    expect(metaColors()).toEqual(['#f6f5f4', '#f6f5f4']);
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
});
