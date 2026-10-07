import { cleanup, render, screen } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useKeepInView } from './useKeepInView';

function Menu({ open, box }: { open: boolean; box: { left: number; width: number } }) {
  const ref = useRef<HTMLDivElement>(null);
  useKeepInView(ref, open);
  if (!open) return null;
  return (
    <div
      ref={(node) => {
        (ref as { current: HTMLDivElement | null }).current = node;
        if (node) {
          node.getBoundingClientRect = () =>
            ({ left: box.left, right: box.left + box.width, width: box.width, top: 0, bottom: 100, height: 100, x: box.left, y: 0 }) as DOMRect;
        }
      }}
      role="menu"
      aria-label="Экспорт"
    />
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('useKeepInView', () => {
  it('brings a menu that opened past the left edge of a phone back in', () => {
    vi.spyOn(document.documentElement, 'clientWidth', 'get').mockReturnValue(390);
    // «Экспорт» at the left of the row, the 240 px menu along its right edge: only 77 px were on screen.
    render(<Menu open box={{ left: -163, width: 240 }} />);
    expect(screen.getByRole('menu').style.getPropertyValue('translate')).toBe('175px 0');
  });

  it('moves one past the right edge back as far as the left edge allows', () => {
    vi.spyOn(document.documentElement, 'clientWidth', 'get').mockReturnValue(390);
    render(<Menu open box={{ left: 300, width: 240 }} />);
    expect(screen.getByRole('menu').style.getPropertyValue('translate')).toBe('-162px 0');
  });

  it('leaves a menu inside the window where it is', () => {
    vi.spyOn(document.documentElement, 'clientWidth', 'get').mockReturnValue(1532);
    render(<Menu open box={{ left: 1178, width: 240 }} />);
    expect(screen.getByRole('menu').style.getPropertyValue('translate')).toBe('');
  });
});
