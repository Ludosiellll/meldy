import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import RouteLoading, { ROUTE_LOADING_DELAY_MS } from './RouteLoading';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('RouteLoading', () => {
  it('is a status on the paper canvas, never the old navy loader', () => {
    render(<RouteLoading />);
    const status = screen.getByRole('status', { name: 'Загрузка страницы' });
    expect(status.className).toContain('bg-[var(--sf-canvas)]');
    expect(status.className).toContain('min-h-screen');
    expect(status.className).not.toMatch(/bg-slate-9|#07111f|bg-\[#/);
  });

  it('shows the spinner and text only after 300 ms', () => {
    expect(ROUTE_LOADING_DELAY_MS).toBe(300);
    const { container } = render(<RouteLoading />);
    expect(screen.queryByText('Загружаем страницу…')).not.toBeInTheDocument();
    expect(container.querySelector('.animate-spin')).toBeNull();

    act(() => {
      vi.advanceTimersByTime(299);
    });
    expect(screen.queryByText('Загружаем страницу…')).not.toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByText('Загружаем страницу…')).toBeInTheDocument();
    const spinner = container.querySelector('.animate-spin');
    expect(spinner).not.toBeNull();
    expect(spinner!.className).toContain('motion-reduce:animate-none');
    expect(spinner!.className).toContain('border-t-[var(--sf-accent-fg)]');
  });

  it('fits inside the layout when not full screen', () => {
    render(<RouteLoading fullScreen={false} />);
    const status = screen.getByRole('status', { name: 'Загрузка страницы' });
    expect(status.className).toContain('min-h-[40vh]');
    expect(status.className).not.toContain('min-h-screen');
    expect(status.className).toContain('bg-[var(--sf-canvas)]');
  });

  it('clears its timer on unmount', () => {
    const { unmount } = render(<RouteLoading />);
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
