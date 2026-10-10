import { createContext, useContext, useEffect, useLayoutEffect, useState } from 'react';

type Theme = 'dark' | 'light' | 'system';
type Resolved = 'dark' | 'light';

type ThemeProviderProps = {
  children: React.ReactNode;
  defaultTheme?: Theme;
  storageKey?: string;
};

type ThemeProviderState = {
  theme: Theme;
  /** Что показывает страница: выбранная тема, а пока выбора нет («system») — тема устройства. */
  resolved: Resolved;
  setTheme: (theme: Theme) => void;
};

/**
 * Цвет полосы браузера и окна PWA = холст темы (--sf-canvas в index.css).
 * Те же значения ставит public/theme-init.js до первой отрисовки.
 */
export const THEME_CANVAS = { light: '#f3f3f0', dark: '#0b0f16' } as const;

const THEMES: readonly Theme[] = ['dark', 'light', 'system'];

const initialState: ThemeProviderState = {
  theme: 'system',
  resolved: 'light',
  setTheme: () => null,
};

const ThemeProviderContext = createContext<ThemeProviderState>(initialState);

function readStoredTheme(storageKey: string): Theme | null {
  try {
    const value = window.localStorage.getItem(storageKey);
    return value && (THEMES as readonly string[]).includes(value) ? (value as Theme) : null;
  } catch {
    return null; // хранилище недоступно (приватный режим, запрет сайта)
  }
}

function systemPrefersDark(): boolean {
  try {
    return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches;
  } catch {
    return false;
  }
}

/** Ставит theme-color всех meta на холст выбранной темы, даже если она не совпадает с темой ОС. */
export function applyThemeColor(effective: 'dark' | 'light') {
  const color = THEME_CANVAS[effective];
  document.querySelectorAll('meta[name="theme-color"]').forEach(meta => meta.setAttribute('content', color));
}

export function ThemeProvider({
  children,
  defaultTheme = 'system',
  storageKey = 'vite-ui-theme',
  ...props
}: ThemeProviderProps) {
  const [theme, setTheme] = useState<Theme>(() => readStoredTheme(storageKey) ?? defaultTheme);
  const [systemDark, setSystemDark] = useState(systemPrefersDark);

  // Выбора нет — страница следует устройству, в том числе когда оно переключается при открытой странице (вечером, вручную).
  useEffect(() => {
    if (theme !== 'system') return;
    let query: MediaQueryList;
    try {
      if (typeof window.matchMedia !== 'function') return;
      query = window.matchMedia('(prefers-color-scheme: dark)');
    } catch {
      return;
    }
    const onChange = () => setSystemDark(query.matches);
    onChange();
    // В Safari до 14 есть только старые addListener/removeListener.
    if (typeof query.addEventListener === 'function') {
      query.addEventListener('change', onChange);
      return () => query.removeEventListener('change', onChange);
    }
    query.addListener?.(onChange);
    return () => query.removeListener?.(onChange);
  }, [theme]);

  const resolved: Resolved = theme === 'system' ? (systemDark ? 'dark' : 'light') : theme;

  // До отрисовки: при переключении нет кадра со старыми цветами, и смена успевает внутрь view transition.
  useLayoutEffect(() => {
    const root = window.document.documentElement;
    root.classList.remove('light', 'dark');
    root.classList.add(resolved);
    applyThemeColor(resolved);
  }, [resolved]);

  const value = {
    theme,
    resolved,
    setTheme: (next: Theme) => {
      try {
        window.localStorage.setItem(storageKey, next);
      } catch {
        // тема применится до перезагрузки страницы
      }
      setTheme(next);
    },
  };

  return (
    <ThemeProviderContext.Provider {...props} value={value}>
      {children}
    </ThemeProviderContext.Provider>
  );
}

export const useTheme = () => {
  const context = useContext(ThemeProviderContext);

  if (context === undefined)
    throw new Error('useTheme must be used within a ThemeProvider');

  return context;
};
