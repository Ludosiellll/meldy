import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useRef } from 'react';
import { HOVER_POINTER, SCROLLING_ATTR, SCROLL_IDLE_MS, useNoHoverWhileScrolling } from './scrollHover';

function pointer(hover: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({ matches: query === HOVER_POINTER ? hover : false, media: query, addEventListener() {}, removeEventListener() {} }),
  });
}

function mount(main: HTMLElement) {
  return renderHook(() => {
    const ref = useRef<HTMLElement | null>(main);
    useNoHoverWhileScrolling(ref);
  });
}

const scroll = () => act(() => void window.dispatchEvent(new Event('scroll')));

let main: HTMLElement;
beforeEach(() => {
  vi.useFakeTimers();
  main = document.createElement('main');
  document.body.append(main);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  main.remove();
  delete (window as unknown as { matchMedia?: unknown }).matchMedia;
});

describe('no hover while the window scrolls (owner, 31.10: «Сегодня» stutters and flickers on scroll)', () => {
  it('marks the page while it scrolls and gives the hover back SCROLL_IDLE_MS after the last scroll', () => {
    pointer(true);
    mount(main);
    expect(main.hasAttribute(SCROLLING_ATTR)).toBe(false);
    scroll();
    expect(main.hasAttribute(SCROLLING_ATTR)).toBe(true);
    // A scroll that goes on keeps it: each event moves the end.
    act(() => void vi.advanceTimersByTime(SCROLL_IDLE_MS - 10));
    scroll();
    act(() => void vi.advanceTimersByTime(SCROLL_IDLE_MS - 10));
    expect(main.hasAttribute(SCROLLING_ATTR)).toBe(true);
    act(() => void vi.advanceTimersByTime(20));
    expect(main.hasAttribute(SCROLLING_ATTR)).toBe(false);
    expect(SCROLL_IDLE_MS).toBeLessThanOrEqual(200);
  });

  it('does nothing on a touch screen, where there is no hover to change', () => {
    pointer(false);
    mount(main);
    scroll();
    expect(main.hasAttribute(SCROLLING_ATTR)).toBe(false);
  });

  it('does nothing without matchMedia, and leaves nothing behind when the shell goes', () => {
    mount(main).unmount();
    scroll();
    expect(main.hasAttribute(SCROLLING_ATTR)).toBe(false);
    pointer(true);
    const hook = mount(main);
    scroll();
    hook.unmount();
    expect(main.hasAttribute(SCROLLING_ATTR)).toBe(false);
    scroll();
    expect(main.hasAttribute(SCROLLING_ATTR)).toBe(false);
  });

  it('the page has no pointer events while it is marked (layout.css)', async () => {
    const NODE_FS: string = 'node:fs';
    const fs = (await import(/* @vite-ignore */ NODE_FS)) as { readFileSync(path: string, encoding: 'utf8'): string };
    const here = decodeURIComponent(import.meta.url.replace(/^file:\/\//, ''));
    const css = fs.readFileSync(`${here.slice(0, here.lastIndexOf('/src/') + 5)}components/layout.css`, 'utf8');
    expect(css).toMatch(/\.sf-main\[data-scrolling\] \{ pointer-events: none; \}/);
  });
});
