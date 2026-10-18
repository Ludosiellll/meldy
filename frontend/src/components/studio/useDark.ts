import { useEffect, useState } from 'react';

const isDark = () => typeof document !== 'undefined' && document.documentElement.classList.contains('dark');

/**
 * The app's theme as the root element carries it (ThemeProvider puts «dark» or «light» on <html>): DocView turns the
 * page's own theme into colours for it (lib/studio/contrast.ts themeTokens). Follows a switch while the page is open.
 */
export function useDark(): boolean {
  const [dark, setDark] = useState(isDark);
  useEffect(() => {
    if (typeof MutationObserver === 'undefined') return;
    const observer = new MutationObserver(() => setDark(isDark()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    setDark(isDark());
    return () => observer.disconnect();
  }, []);
  return dark;
}

/** The user asked the system for less motion. */
export function reducedMotion(): boolean {
  try {
    return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}
