import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from '../contexts/ThemeProvider';
import ThemeToggle, { themeToggleLabel } from './ThemeToggle';

const KEY = 'studyforge-theme';
let osDark = false;
let calm = false;

function stubMatchMedia() {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: query.includes('prefers-color-scheme: dark') ? osDark : query.includes('reduced-motion') ? calm : false,
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

/** jsdom has no view transitions: a test gives the document its own and takes it away after. */
function giveViewTransitions(start: (update: () => void) => unknown) {
  Object.defineProperty(document, 'startViewTransition', { configurable: true, writable: true, value: start });
}

function renderToggle() {
  return render(
    <ThemeProvider defaultTheme="system" storageKey={KEY}>
      <ThemeToggle />
    </ThemeProvider>,
  );
}

const button = () => screen.getByRole('button', { name: /^Включить (тёмную|светлую) тему$/ });

beforeEach(() => {
  osDark = false;
  calm = false;
  stubMatchMedia();
  document.documentElement.className = '';
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(document, 'startViewTransition');
});

describe('ThemeToggle', () => {
  it('says what a press does', () => {
    expect(themeToggleLabel(false)).toBe('Включить тёмную тему');
    expect(themeToggleLabel(true)).toBe('Включить светлую тему');
  });

  it('turns the light page dark and back, and remembers the choice', () => {
    renderToggle();
    expect(document.documentElement.className).toBe('light');
    expect(button()).toHaveAccessibleName('Включить тёмную тему');
    expect(button()).not.toHaveAttribute('data-dark');
    fireEvent.click(button());
    expect(document.documentElement.className).toBe('dark');
    expect(window.localStorage.getItem(KEY)).toBe('dark');
    expect(button()).toHaveAccessibleName('Включить светлую тему');
    expect(button()).toHaveAttribute('data-dark', '');
    fireEvent.click(button());
    expect(document.documentElement.className).toBe('light');
    expect(window.localStorage.getItem(KEY)).toBe('light');
  });

  it('starts from the device: on a dark device the first press makes the page light', () => {
    osDark = true;
    renderToggle();
    expect(document.documentElement.className).toBe('dark');
    expect(button()).toHaveAccessibleName('Включить светлую тему');
    fireEvent.click(button());
    expect(document.documentElement.className).toBe('light');
    expect(window.localStorage.getItem(KEY)).toBe('light');
  });

  it('fades into the new colours where the browser can: the page has them when the update returns', () => {
    let classInsideUpdate = '';
    const startViewTransition = vi.fn((update: () => void) => {
      act(() => update());
      classInsideUpdate = document.documentElement.className;
      return {};
    });
    giveViewTransitions(startViewTransition);
    renderToggle();
    fireEvent.click(button());
    expect(startViewTransition).toHaveBeenCalledTimes(1);
    expect(classInsideUpdate).toBe('dark');
    expect(button()).toHaveAccessibleName('Включить светлую тему');
  });

  it('switches at once with reduced motion', () => {
    calm = true;
    const startViewTransition = vi.fn();
    giveViewTransitions(startViewTransition);
    renderToggle();
    fireEvent.click(button());
    expect(startViewTransition).not.toHaveBeenCalled();
    expect(document.documentElement.className).toBe('dark');
  });

  it('works where the browser has no matchMedia', () => {
    Object.defineProperty(window, 'matchMedia', { configurable: true, writable: true, value: undefined });
    renderToggle();
    expect(document.documentElement.className).toBe('light');
    fireEvent.click(button());
    expect(document.documentElement.className).toBe('dark');
  });
});
