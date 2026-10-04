import { useEffect, useState } from 'react';

/** Через сколько миллисекунд показать индикатор: быстрые загрузки обходятся цветом страницы. */
export const ROUTE_LOADING_DELAY_MS = 300;

/**
 * Заглушка на время загрузки страницы (Suspense и проверка сессии).
 * Фон — холст темы, поэтому холодная загрузка не вспыхивает тёмно-синим.
 * Спиннер и подпись появляются только через 300 мс; во весь экран — со словесным знаком Meldy
 * (Meldy 2026-10-04, стили .ac-loading в styles/legacy.css).
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
        <div className="ac-loading">
          {fullScreen && (
            <span className="au-logo ac-loading-mark" aria-hidden="true">
              Meldy
            </span>
          )}
          <span
            aria-hidden="true"
            className="ac-loading-ring rounded-full border-[var(--sf-line)] border-t-[var(--sf-accent-fg)] animate-spin motion-reduce:animate-none"
          />
          <p className="ac-loading-text">Загружаем страницу…</p>
        </div>
      )}
    </div>
  );
}
