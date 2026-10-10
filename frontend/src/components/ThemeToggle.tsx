import { flushSync } from 'react-dom';
import { Moon, Sun } from 'lucide-react';
import { useTheme } from '../contexts/ThemeProvider';

/** The button's name and tooltip: what a press does. */
export const themeToggleLabel = (dark: boolean) => (dark ? 'Включить светлую тему' : 'Включить тёмную тему');

/**
 * The theme in one press, right of the account button in the top line (the owner, 2026-10-10: the three themes in the
 * account menu were not found there). The icon is the theme on the screen, the sun on the light page and the moon on
 * the dark one; the name says what a press does. Until the first press the page follows the device (ThemeProvider,
 * «system»). Where the browser has view transitions the page fades into the new colours, except with reduced motion.
 */
export default function ThemeToggle() {
  const { resolved, setTheme } = useTheme();
  const dark = resolved === 'dark';
  const label = themeToggleLabel(dark);

  const flip = () => {
    const next = dark ? 'light' : 'dark';
    let calm = false;
    try {
      calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch {
      calm = false;
    }
    // Older browsers have no view transitions.
    if (calm || typeof document.startViewTransition !== 'function') {
      setTheme(next);
      return;
    }
    // The new colours must be on the page when the update returns: ThemeProvider sets them in a layout effect.
    document.startViewTransition(() => flushSync(() => setTheme(next)));
  };

  return (
    <button type="button" className="sf-theme" aria-label={label} title={label} data-dark={dark ? '' : undefined} onClick={flip}>
      <Sun className="sf-theme-sun" aria-hidden="true" strokeWidth={1.75} />
      <Moon className="sf-theme-moon" aria-hidden="true" strokeWidth={1.75} />
    </button>
  );
}
