import { useEffect, useState } from 'react';

/** Через сколько миллисекунд показать индикатор: быстрые загрузки обходятся цветом страницы. */
export const ROUTE_LOADING_DELAY_MS = 300;

/**
 * Заглушка на время загрузки страницы (Suspense и проверка сессии).
 * Фон — бумажный холст темы, поэтому холодная загрузка не вспыхивает тёмно-синим.
 * Спиннер и подпись появляются только через 300 мс.
 */
export default function RouteLoading({ fullScreen = true }: { fullScreen?: boolean }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setVisible(true), ROUTE_LOADING_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <div
      role="status"
      aria-label="Загрузка страницы"
      aria-live="polite"
      className={`flex w-full items-center justify-center bg-[var(--sf-canvas)] text-[var(--sf-muted)] ${
        fullScreen ? 'min-h-screen' : 'min-h-[40vh]'
      }`}
    >
      {visible && (
        <div className="flex flex-col items-center gap-3">
          <span
            aria-hidden="true"
            className="h-6 w-6 rounded-full border-2 border-[var(--sf-line)] border-t-[var(--sf-accent-fg)] animate-spin motion-reduce:animate-none"
          />
          <p className="text-sm">Загружаем страницу…</p>
        </div>
      )}
    </div>
  );
}
