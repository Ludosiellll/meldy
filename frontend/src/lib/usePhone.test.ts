import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { PHONE_QUERY, isPhone, usePhone } from './usePhone';

type Listener = () => void;

function installMatchMedia(initial: boolean) {
  const listeners = new Set<Listener>();
  const state = { matches: initial };
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({
      get matches() {
        return query === PHONE_QUERY ? state.matches : false;
      },
      media: query,
      addEventListener: (_: string, fn: Listener) => listeners.add(fn),
      removeEventListener: (_: string, fn: Listener) => listeners.delete(fn),
    }),
  });
  return {
    set(next: boolean) {
      state.matches = next;
      listeners.forEach((fn) => fn());
    },
    listeners,
  };
}

afterEach(() => {
  cleanup();
  // jsdom has no matchMedia of its own.
  delete (window as unknown as { matchMedia?: unknown }).matchMedia;
});

describe('usePhone', () => {
  it('is false without matchMedia, so the computer layout is the default', () => {
    delete (window as unknown as { matchMedia?: unknown }).matchMedia;
    const { result } = renderHook(() => usePhone());
    expect(result.current).toBe(false);
    expect(isPhone()).toBe(false);
  });

  it('follows the phone query and its changes, and lets go of the listener', () => {
    const mm = installMatchMedia(true);
    const { result, unmount } = renderHook(() => usePhone());
    expect(result.current).toBe(true);
    act(() => mm.set(false));
    expect(result.current).toBe(false);
    act(() => mm.set(true));
    expect(result.current).toBe(true);
    unmount();
    expect(mm.listeners.size).toBe(0);
  });

  it('is false when matchMedia throws', () => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: () => {
        throw new Error('no media queries');
      },
    });
    const { result } = renderHook(() => usePhone());
    expect(result.current).toBe(false);
  });
});
