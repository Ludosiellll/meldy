/**
 * The draw screen and the answer screen open without a «Загружаем…» flash (redesign spec 5.10):
 * their code is fetched while the sheet is idle and on hover or focus of «Тянуть билет». The answer
 * screen belongs to the «Ответ вслух» package; the glob keeps this building while it lands.
 */
import type { ComponentType } from 'react';

const ticketScreens = import.meta.glob<{ default: ComponentType }>('../../pages/ExamTicket.tsx');

export function preloadTicketScreen(): void {
  const load = ticketScreens['../../pages/ExamTicket.tsx'];
  if (load) void load().catch(() => undefined);
}

export function preloadDrawScreen(): void {
  void import('../../pages/ExamDraw').catch(() => undefined);
}

/** Runs `task` when the browser is idle (or after a short delay); returns a cancel function. */
export function whenIdle(task: () => void, timeoutMs = 1500): () => void {
  const win = window as Window & {
    requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
    cancelIdleCallback?: (handle: number) => void;
  };
  if (typeof win.requestIdleCallback === 'function') {
    const handle = win.requestIdleCallback(task, { timeout: timeoutMs });
    return () => win.cancelIdleCallback?.(handle);
  }
  const timer = window.setTimeout(task, 400);
  return () => window.clearTimeout(timer);
}
