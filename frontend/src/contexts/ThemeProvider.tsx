import { createContext, useContext, useEffect, useState } from 'react';

type Theme = 'dark' | 'light' | 'system';

type ThemeProviderProps = {
  children: React.ReactNode;
  defaultTheme?: Theme;
  storageKey?: string;
};

type ThemeProviderState = {
  theme: Theme;
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

  useEffect(() => {
    const root = window.document.documentElement;
    const effective = theme === 'system' ? (systemPrefersDark() ? 'dark' : 'light') : theme;

    root.classList.remove('light', 'dark');
    root.classList.add(effective);
    applyThemeColor(effective);
  }, [theme]);

  const value = {
    theme,
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
